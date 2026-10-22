import { parseIsoDuration } from '@shared/matching'
import { LIKED_ID, type AddedTrack, type Playlist, type Track } from '@shared/types'
import { ApiClient, ApiError, chunk } from '../http'
import { authorize } from '../oauth'
import { getSettings, getToken, saveToken } from '../store'
import type { MusicProvider } from './types'

/*
 * TIDAL API v2 (openapi.tidal.com/v2) — format JSON:API.
 * Les relations (artistes, album, pochette) arrivent dans `included`
 * quand on les demande via `include=`.
 */

const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token'
const BASE = 'https://openapi.tidal.com/v2'

interface Ident { id: string; type: string; meta?: { addedAt?: string; itemId?: string } }
interface Res extends Ident {
  attributes?: Record<string, any>
  relationships?: Record<string, { data?: Ident | Ident[] | null }>
}
interface Doc<D = Res[] | Ident[]> {
  data: D
  included?: Res[]
  links?: { next?: string; meta?: { nextCursor?: string } }
}

type Lookup = Map<string, Res>
const lookupOf = (doc: Doc<unknown>): Lookup => {
  const m: Lookup = new Map()
  for (const r of doc.included ?? []) m.set(`${r.type}:${r.id}`, r)
  if (Array.isArray(doc.data)) {
    for (const r of doc.data as Res[]) if (r.attributes) m.set(`${r.type}:${r.id}`, r)
  }
  return m
}

const rel = (r: Res | undefined, name: string): Ident[] => {
  const d = r?.relationships?.[name]?.data
  return !d ? [] : Array.isArray(d) ? d : [d]
}

function artworkUrl(art: Res | undefined, target = 320): string | undefined {
  const files = (art?.attributes?.files ?? []) as { href: string; meta?: { width?: number } }[]
  if (!files.length) return undefined
  return [...files].sort(
    (a, b) => Math.abs((a.meta?.width ?? 0) - target) - Math.abs((b.meta?.width ?? 0) - target)
  )[0].href
}

function buildTrack(id: string, lk: Lookup, addedAt?: string): Track | null {
  const r = lk.get(`tracks:${id}`)
  if (!r?.attributes) return null
  const a = r.attributes
  const album = lk.get(`albums:${rel(r, 'albums')[0]?.id}`)
  const cover = lk.get(`artworks:${rel(album, 'coverArt')[0]?.id}`)
  return {
    id,
    service: 'tidal',
    title: a.title,
    version: a.version || undefined,
    artists: rel(r, 'artists')
      .map((x) => lk.get(`artists:${x.id}`)?.attributes?.name as string | undefined)
      .filter((x): x is string => !!x),
    album: album?.attributes?.title,
    durationMs: parseIsoDuration(a.duration),
    isrc: a.isrc ?? null,
    cover: artworkUrl(cover),
    explicit: a.explicit,
    addedAt
  }
}

function nextCursor(doc: Doc<unknown>): string | undefined {
  if (doc.links?.meta?.nextCursor) return doc.links.meta.nextCursor
  if (!doc.links?.next) return undefined
  return new URL(doc.links.next, BASE).searchParams.get('page[cursor]') ?? undefined
}

export class TidalProvider implements MusicProvider {
  readonly service = 'tidal' as const
  private accountCountry?: string

  private api = new ApiClient({
    service: 'tidal',
    baseUrl: BASE,
    tokenUrl: TOKEN_URL,
    clientId: () => getSettings().tidalClientId,
    defaultHeaders: { Accept: 'application/vnd.api+json' }
  })

  private country(): string {
    return getSettings().tidalCountry || this.accountCountry || 'FR'
  }

  isConfigured(): boolean {
    return !!getSettings().tidalClientId
  }

  isConnected(): boolean {
    return !!getToken('tidal')
  }

  async connect(): Promise<void> {
    const { tidalClientId, tidalScopes } = getSettings()
    if (!tidalClientId) throw new Error('Renseigne d’abord le Client ID TIDAL dans les réglages.')
    const token = await authorize({
      authorizeUrl: 'https://login.tidal.com/authorize',
      tokenUrl: TOKEN_URL,
      clientId: tidalClientId,
      scopes: tidalScopes
    })
    await saveToken('tidal', token)
  }

  async disconnect(): Promise<void> {
    await saveToken('tidal', null)
  }

  async me(): Promise<{ id: string; displayName: string }> {
    const doc = await this.api.get<Doc<Res>>('/users/me')
    const a = doc.data.attributes ?? {}
    if (a.country) this.accountCountry = a.country
    return {
      id: doc.data.id,
      displayName: a.username ?? ([a.firstName, a.lastName].filter(Boolean).join(' ') || a.email || 'Compte TIDAL')
    }
  }

  /**
   * GET paginé. `includes` = liste de variantes du paramètre include, de la plus
   * riche à la plus simple : si l'API refuse une variante (400), on passe à la suivante.
   */
  private async pages(
    path: string,
    query: Record<string, string>,
    includes: string[],
    onPage: (doc: Doc, lk: Lookup) => void
  ): Promise<void> {
    let variant = 0
    let cursor: string | undefined
    for (;;) {
      let doc: Doc
      try {
        doc = await this.api.get<Doc>(path, {
          ...query,
          include: includes[variant],
          'page[cursor]': cursor
        })
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && variant < includes.length - 1) {
          variant++
          continue
        }
        throw e
      }
      onPage(doc, lookupOf(doc))
      cursor = nextCursor(doc)
      if (!cursor) break
    }
  }

  async listPlaylists(): Promise<Playlist[]> {
    if (!this.accountCountry) await this.me().catch(() => undefined)
    const out = new Map<string, Playlist>()
    const collect = (editable: boolean) => (doc: Doc, lk: Lookup) => {
      for (const ref of doc.data as Ident[]) {
        if (ref.type !== 'playlists' || out.has(ref.id)) continue
        const r = lk.get(`playlists:${ref.id}`)
        const a = r?.attributes ?? {}
        out.set(ref.id, {
          id: ref.id,
          service: 'tidal',
          name: a.name ?? 'Sans titre',
          description: a.description || undefined,
          trackCount: a.numberOfItems,
          cover: artworkUrl(lk.get(`artworks:${rel(r, 'coverArt')[0]?.id}`)),
          editable,
          updatedAt: a.lastModifiedAt || a.createdAt
        })
      }
    }
    // Un mix d'historique annoncé sur le fil (mois ou année), s'il n'est pas déjà listé.
    const collectHistory = (doc: Doc, lk: Lookup) => {
      for (const ref of doc.data as Res[]) {
        const details = ref.attributes?.activityDetails as { activityType?: string; period?: string } | undefined
        if (details?.activityType !== 'HISTORY_MIX_READY') continue
        const subject = rel(ref, 'subject')[0]
        if (!subject || out.has(subject.id)) continue
        const playlist = lk.get(`playlists:${subject.id}`)
        const a = playlist?.attributes ?? {}
        out.set(subject.id, {
          id: subject.id,
          service: 'tidal',
          name: a.name ?? (details.period ? `Historique ${details.period}` : 'Historique'),
          description: a.description || undefined,
          trackCount: a.numberOfItems,
          cover: artworkUrl(lk.get(`artworks:${rel(playlist, 'coverArt')[0]?.id}`)),
          editable: false
        })
      }
    }
    const country = this.country()

    // Titres favoris : playlist virtuelle en tête de liste
    out.set(LIKED_ID, {
      id: LIKED_ID,
      kind: 'liked',
      service: 'tidal',
      name: 'Titres favoris',
      editable: true
    })

    // Mes playlists
    await this.pages(
      '/playlists',
      { 'filter[owners.id]': 'me', countryCode: country, sort: '-lastModifiedAt' },
      ['coverArt', ''],
      collect(true)
    )
    // Playlists où je suis collaborateur
    await this.pages(
      '/playlists',
      { 'filter[collaborators.id]': 'me', countryCode: country, sort: '-lastModifiedAt' },
      ['coverArt', ''],
      collect(true)
    ).catch(() => undefined)
    // Playlists favorites. Les mixes d'historique enregistrés (un par mois, plus l'année)
    // arrivent ici, en lecture seule. La liste complète de l'accueil TIDAL exige le
    // scope interne r_usr, qui refuse toute la connexion.
    await this.pages(
      '/userCollectionPlaylists/me/relationships/items',
      { countryCode: country },
      ['items,items.coverArt', 'items'],
      collect(false)
    ).catch(() => undefined)
    for (const surface of ['FEED', 'INBOX']) {
      await this.pages(
        '/userFeedItems',
        { 'filter[owners.id]': 'me', 'filter[surface]': surface },
        ['subject,subject.coverArt', 'subject'],
        collectHistory
      ).catch(() => undefined)
    }

    return [...out.values()]
  }

  async getTracks(
    playlistId: string,
    onProgress?: (loaded: number, total?: number) => void
  ): Promise<Track[]> {
    const tracks: Track[] = []
    await this.pages(
      playlistId === LIKED_ID
        ? '/userCollectionTracks/me/relationships/items'
        : `/playlists/${playlistId}/relationships/items`,
      { countryCode: this.country() },
      ['items,items.artists,items.albums.coverArt', 'items,items.artists', 'items'],
      (doc, lk) => {
        for (const ref of doc.data as Ident[]) {
          if (ref.type !== 'tracks') continue // on ignore les clips vidéo
          const t = buildTrack(ref.id, lk, ref.meta?.addedAt)
          if (t) tracks.push(t)
        }
        onProgress?.(tracks.length)
      }
    )
    return tracks
  }

  private async tracksFrom(path: string, query: Record<string, string>, includes: string[]): Promise<Track[]> {
    const out: Track[] = []
    for (const include of includes) {
      try {
        const doc = await this.api.get<Doc>(path, { ...query, include })
        const lk = lookupOf(doc)
        for (const ref of doc.data as Ident[]) {
          const t = ref.type === 'tracks' ? buildTrack(ref.id, lk) : null
          if (t) out.push(t)
        }
        return out
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 400)) throw e
      }
    }
    return out
  }

  searchByIsrc(isrc: string): Promise<Track[]> {
    return this.tracksFrom(
      '/tracks',
      { 'filter[isrc]': isrc, countryCode: this.country() },
      ['artists,albums.coverArt', 'artists']
    )
  }

  searchText(title: string, artist: string): Promise<Track[]> {
    return this.search(`${title} ${artist}`)
  }

  async search(query: string): Promise<Track[]> {
    const q = encodeURIComponent(query.trim())
    return this.tracksFrom(
      `/searchResults/${q}/relationships/tracks`,
      { countryCode: this.country() },
      ['tracks,tracks.artists,tracks.albums.coverArt', 'tracks,tracks.artists', 'tracks']
    )
  }

  async createPlaylist(name: string, description?: string): Promise<Playlist> {
    const doc = await this.api.post<Doc<Res>>('/playlists', {
      data: {
        type: 'playlists',
        attributes: { name, description: description ?? 'Créée avec Playlist Bridge' }
      }
    })
    return {
      id: doc.data.id,
      service: 'tidal',
      name: doc.data.attributes?.name ?? name,
      trackCount: 0,
      editable: true
    }
  }

  async addTracks(
    playlistId: string,
    tracks: Track[],
    onProgress?: (done: number) => void,
    allowDuplicates = false
  ): Promise<{ added: number; skipped: number; tracks: AddedTrack[] }> {
    const added = new Set<string>()
    let done = 0
    const note = (ids: string[]): void => {
      for (const id of ids) added.add(id)
      done = allowDuplicates ? done + ids.length : added.size
      onProgress?.(done)
    }
    if (playlistId === LIKED_ID) {
      // Favoris listés du plus récent au plus ancien : on envoie la fin d'abord.
      for (const part of chunk([...tracks].reverse(), 20)) {
        const doc = await this.api.post<Doc>('/userCollectionTracks/me/relationships/items', {
          data: part.map((t) => ({ id: t.id, type: 'tracks' }))
        })
        const rows = Array.isArray(doc.data) ? (doc.data as Ident[]) : []
        const ids = rows.map((r) => r.id).filter(Boolean)
        note(ids.length ? ids : part.map((t) => t.id))
      }
    } else {
      // En bas, dans l'ordre de la source. Sans position, TIDAL ajoute à la fin.
      for (const part of chunk(tracks, 20)) {
        const doc = await this.api.post<Doc>(`/playlists/${playlistId}/relationships/items`, {
          data: part.map((t) => ({ id: t.id, type: 'tracks' })),
          meta: { onDuplicates: allowDuplicates ? 'ADD' : 'SKIP' }
        })
        const placed = Array.isArray(doc.data) ? (doc.data as Ident[]) : []
        note(placed.map((r) => r.id))
      }
    }
    return {
      added: done,
      skipped: tracks.length - done,
      tracks: tracks.filter((t) => added.has(t.id)).map((t) => ({ id: t.id }))
    }
  }

  async removeTracks(playlistId: string, tracks: AddedTrack[]): Promise<number> {
    if (!tracks.length) return 0
    const path =
      playlistId === LIKED_ID
        ? '/userCollectionTracks/me/relationships/items'
        : `/playlists/${playlistId}/relationships/items`
    for (const part of chunk(tracks, 20)) {
      await this.api.request('DELETE', path, {
        body: { data: part.map((t) => ({ id: t.id, type: 'tracks' })) }
      })
    }
    return tracks.length
  }
}
