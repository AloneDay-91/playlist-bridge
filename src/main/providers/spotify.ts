import { LIKED_ID, type AddedTrack, type Playlist, type Track } from '@shared/types'
import { ApiClient, ApiError, chunk } from '../http'
import { authorize } from '../oauth'
import { getSettings, getToken, saveToken } from '../store'
import type { MusicProvider } from './types'

/*
 * Spotify Web API — en tenant compte des changements du mode Développement
 * de février 2026 : /playlists/{id}/items (plus /tracks), champ `item`
 * (plus `track`), POST /me/playlists, limite de recherche à 10.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  // Titres likés
  'user-library-read',
  'user-library-modify'
].join(' ')

const RECONNECT = 'Reconnecte Spotify (Déconnecter puis Connecter) pour autoriser l’accès aux titres likés.'

interface SpImage { url: string; width?: number | null }
interface SpTrack {
  id: string | null
  uri: string
  type?: string
  name: string
  duration_ms: number
  explicit?: boolean
  is_local?: boolean
  artists: { name: string }[]
  album?: { name: string; images?: SpImage[] }
  external_ids?: { isrc?: string }
}
interface SpPage<T> { items: T[]; next: string | null; total?: number }
interface SpPlaylist {
  id: string
  name: string
  description?: string
  collaborative?: boolean
  owner?: { id: string }
  images?: SpImage[] | null
  items?: { total: number }
  tracks?: { total: number }
}

const pickImage = (imgs?: SpImage[] | null): string | undefined => {
  if (!imgs?.length) return undefined
  // Spotify trie du plus grand au plus petit : on vise ~300px
  return (imgs.find((i) => (i.width ?? 0) <= 320 && (i.width ?? 0) >= 160) ?? imgs[0]).url
}

const toTrack = (t: SpTrack, addedAt?: string): Track => ({
  id: t.id ?? t.uri,
  service: 'spotify',
  uri: t.uri,
  title: t.name,
  artists: t.artists.map((a) => a.name),
  album: t.album?.name,
  durationMs: t.duration_ms,
  isrc: t.external_ids?.isrc ?? null,
  cover: pickImage(t.album?.images),
  explicit: t.explicit,
  addedAt
})

const toPlaylist = (p: SpPlaylist, myId?: string): Playlist => ({
  id: p.id,
  service: 'spotify',
  name: p.name,
  description: p.description || undefined,
  trackCount: p.items?.total ?? p.tracks?.total,
  cover: pickImage(p.images),
  editable: !!myId && (p.owner?.id === myId || !!p.collaborative)
})

export class SpotifyProvider implements MusicProvider {
  readonly service = 'spotify' as const
  private myId?: string

  private api = new ApiClient({
    service: 'spotify',
    baseUrl: 'https://api.spotify.com/v1',
    tokenUrl: TOKEN_URL,
    clientId: () => getSettings().spotifyClientId
  })

  isConfigured(): boolean {
    return !!getSettings().spotifyClientId
  }

  isConnected(): boolean {
    return !!getToken('spotify')
  }

  async connect(): Promise<void> {
    const clientId = getSettings().spotifyClientId
    if (!clientId) throw new Error('Renseigne d’abord le Client ID Spotify dans les réglages.')
    const token = await authorize({
      authorizeUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: TOKEN_URL,
      clientId,
      scopes: SCOPES
    })
    await saveToken('spotify', token)
  }

  async disconnect(): Promise<void> {
    await saveToken('spotify', null)
    this.myId = undefined
  }

  async me(): Promise<{ id: string; displayName: string }> {
    const me = await this.api.get<{ id: string; display_name?: string }>('/me')
    this.myId = me.id
    return { id: me.id, displayName: me.display_name ?? me.id }
  }

  private async all<T>(path: string, query?: Record<string, string | number>): Promise<T[]> {
    const out: T[] = []
    let page = await this.api.get<SpPage<T>>(path, query)
    out.push(...page.items)
    while (page.next) {
      page = await this.api.get<SpPage<T>>(page.next)
      out.push(...page.items)
    }
    return out
  }

  async listPlaylists(): Promise<Playlist[]> {
    if (!this.myId) await this.me()
    const items = await this.all<SpPlaylist | null>('/me/playlists', { limit: 50 })
    // Titres likés : on ne lit que le total ici (1 titre demandé)
    const likedTotal = await this.api
      .get<SpPage<unknown>>('/me/tracks', { limit: 1 })
      .then((r) => r.total)
      .catch(() => undefined)
    const liked: Playlist = {
      id: LIKED_ID,
      kind: 'liked',
      service: 'spotify',
      name: 'Titres likés',
      trackCount: likedTotal,
      editable: true
    }
    // En mode Développement, Spotify ne renvoie le contenu que des playlists
    // dont on est propriétaire ou collaborateur : on n'affiche que celles-là.
    return [
      liked,
      ...items
        .filter((p): p is SpPlaylist => !!p)
        .map((p) => toPlaylist(p, this.myId))
        .filter((p) => p.editable)
    ]
  }

  async getTracks(
    playlistId: string,
    onProgress?: (loaded: number, total?: number) => void
  ): Promise<Track[]> {
    type Item = { added_at?: string; item?: SpTrack | null; track?: SpTrack | null }
    const tracks: Track[] = []
    const first = (): Promise<SpPage<Item>> =>
      playlistId === LIKED_ID
        ? this.api.get<SpPage<Item>>('/me/tracks', { limit: 50 }).catch((e) => {
            throw e instanceof ApiError && (e.status === 401 || e.status === 403) ? new Error(RECONNECT) : e
          })
        : this.api.get<SpPage<Item>>(`/playlists/${playlistId}/items`, { limit: 50, additional_types: 'track' })
    let page = await first()
    for (;;) {
      for (const it of page.items) {
        const t = it.item ?? it.track
        // On ignore épisodes de podcast et fichiers locaux (non transférables)
        if (!t || (t.type && t.type !== 'track') || t.is_local || !t.id) continue
        tracks.push(toTrack(t, it.added_at))
      }
      onProgress?.(tracks.length, page.total)
      if (!page.next) break
      page = await this.api.get<SpPage<Item>>(page.next)
    }
    return tracks
  }

  async searchByIsrc(isrc: string): Promise<Track[]> {
    const res = await this.api.get<{ tracks: SpPage<SpTrack> }>('/search', {
      q: `isrc:${isrc}`,
      type: 'track',
      limit: 5
    })
    return res.tracks.items.map((t) => toTrack(t))
  }

  async searchText(title: string, artist: string): Promise<Track[]> {
    const clean = (s: string): string => s.replace(/[":]/g, ' ').trim()
    const strict = await this.api.get<{ tracks: SpPage<SpTrack> }>('/search', {
      q: `track:${clean(title)} artist:${clean(artist)}`,
      type: 'track',
      limit: 10
    })
    if (strict.tracks.items.length) return strict.tracks.items.map((t) => toTrack(t))
    const loose = await this.api.get<{ tracks: SpPage<SpTrack> }>('/search', {
      q: `${clean(title)} ${clean(artist)}`,
      type: 'track',
      limit: 10
    })
    return loose.tracks.items.map((t) => toTrack(t))
  }

  async search(query: string): Promise<Track[]> {
    const res = await this.api.get<{ tracks: SpPage<SpTrack> }>('/search', { q: query, type: 'track', limit: 10 })
    return res.tracks.items.map((t) => toTrack(t))
  }

  async createPlaylist(name: string, description?: string): Promise<Playlist> {
    if (!this.myId) await this.me()
    const p = await this.api.post<SpPlaylist>('/me/playlists', {
      name,
      description: description ?? 'Créée avec Playlist Bridge',
      public: false
    })
    return toPlaylist(p, this.myId)
  }

  async addTracks(
    playlistId: string,
    tracks: Track[],
    onProgress?: (done: number) => void
  ): Promise<{ added: number; skipped: number; tracks: AddedTrack[] }> {
    // Titres likés : la liste est du plus récent au plus ancien, on ajoute
    // donc la fin de la source d'abord pour que le début reste en tête.
    const ordered = playlistId === LIKED_ID ? [...tracks].reverse() : tracks
    const uris = ordered.map((t) => t.uri ?? `spotify:track:${t.id}`)
    let done = 0
    if (playlistId === LIKED_ID) {
      // Nouveau endpoint générique de bibliothèque : 40 URIs max par appel
      for (const part of chunk(uris, 40)) {
        await this.api
          .request('PUT', '/me/library', { query: { uris: part.join(',') } })
          .catch((e) => {
            throw e instanceof ApiError && (e.status === 401 || e.status === 403) ? new Error(RECONNECT) : e
          })
        done += part.length
        onProgress?.(done)
      }
    } else {
      // En bas, dans l'ordre de la source. Sans position, Spotify ajoute à la fin.
      for (const part of chunk(uris, 100)) {
        await this.api.post(`/playlists/${playlistId}/items`, { uris: part })
        done += part.length
        onProgress?.(done)
      }
    }
    return {
      added: done,
      skipped: 0,
      tracks: tracks.map((t) => ({ id: t.id, uri: t.uri ?? `spotify:track:${t.id}` }))
    }
  }

  async removeTracks(playlistId: string, tracks: AddedTrack[]): Promise<number> {
    if (!tracks.length) return 0
    const uris = tracks.map((t) => t.uri ?? `spotify:track:${t.id}`)
    if (playlistId === LIKED_ID) {
      for (const part of chunk(uris, 40)) {
        await this.api.request('DELETE', '/me/library', { query: { uris: part.join(',') } }).catch((e) => {
          throw e instanceof ApiError && (e.status === 401 || e.status === 403) ? new Error(RECONNECT) : e
        })
      }
      return uris.length
    }
    for (const part of chunk(uris, 100)) {
      await this.api.request('DELETE', `/playlists/${playlistId}/items`, {
        body: { items: part.map((uri) => ({ uri })) }
      })
    }
    return uris.length
  }
}
