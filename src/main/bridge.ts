import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { BridgeApi } from '@shared/api'
import { addedSuffix, sortPlaylists } from '@shared/library'
import type {
  AccountStatus,
  AddTarget,
  AppSettings,
  ExportResult,
  AddedTrack,
  HistoryEntry,
  ProgressEvent,
  Service,
  Track
} from '@shared/types'
import { ApiError } from './http'
import { REDIRECT_URI } from './oauth'
import { SpotifyProvider } from './providers/spotify'
import { TidalProvider } from './providers/tidal'
import type { MusicProvider } from './providers/types'
import { resolveTracks } from './resolve'
import {
  addHistory,
  clearHistory,
  getHistory,
  getMatch,
  getSettings,
  saveSettings,
  setMatches,
  updateHistory,
  whenReady
} from './store'

const providers: Record<Service, MusicProvider> = {
  spotify: new SpotifyProvider(),
  tidal: new TidalProvider()
}

/** Retrouve les titres d'un ancien ajout, quand l'historique ne les a pas gardés. */
async function tracksOf(provider: MusicProvider, entry: HistoryEntry): Promise<{ playlistId: string; tracks: AddedTrack[] }> {
  const lists = await provider.listPlaylists()
  const ids = entry.playlistId
    ? [entry.playlistId]
    : lists.filter((p) => p.name === entry.target.name && p.editable).map((p) => p.id)
  for (const playlistId of ids) {
    if (entry.addedTracks?.length) return { playlistId, tracks: entry.addedTracks }
    const found = addedSuffix(await provider.getTracks(playlistId), entry.date, entry.added)
    if (found) return { playlistId, tracks: found.map((t) => ({ id: t.id, uri: t.uri })) }
  }
  throw new Error(`Impossible de retrouver les ${entry.added} titres ajoutés à ${entry.target.name}.`)
}

const listeners = new Set<(e: ProgressEvent) => void>()
const progress = (e: ProgressEvent): void => {
  for (const cb of listeners) cb(e)
}

async function status(service: Service): Promise<AccountStatus> {
  const p = providers[service]
  const base = { service, configured: p.isConfigured(), connected: p.isConnected() }
  if (!base.connected) return base
  try {
    return { ...base, displayName: (await p.me()).displayName }
  } catch (e) {
    // 401 : session morte. Un autre code (scope manquant) laisse le compte connecté,
    // sinon les playlists ne sont même pas demandées.
    if (e instanceof ApiError && e.status === 401) return { ...base, connected: false }
    return base
  }
}

/** Pont `BridgeApi` dans le process de la webview. Le natif ne garde que l'OS. */
export function createDesktopApi(): BridgeApi {
  return {
    getSettings: async () => (await whenReady(), getSettings()),
    saveSettings: async (patch: Partial<AppSettings>) => (await whenReady(), saveSettings(patch)),
    redirectUri: async () => REDIRECT_URI,

    accounts: async () => (await whenReady(), Promise.all([status('spotify'), status('tidal')])),
    connect: async (s: Service) => {
      await whenReady()
      await providers[s].connect()
      await getCurrentWindow().setFocus()
      return status(s)
    },
    disconnect: async (s: Service) => {
      await whenReady()
      await providers[s].disconnect()
    },

    playlists: async (s: Service) => {
      await whenReady()
      return sortPlaylists(await providers[s].listPlaylists())
    },
    tracks: async (s: Service, id: string, jobId?: string) => {
      await whenReady()
      return providers[s].getTracks(id, (done, total) => {
        if (jobId) progress({ jobId, phase: 'loading', done, total: total ?? 0 })
      })
    },

    resolve: async (jobId, target, sources, targetTracks) => {
      await whenReady()
      return resolveTracks(providers[target], sources, targetTracks, (done) =>
        progress({ jobId, phase: 'resolving', done, total: sources.length })
      )
    },

    add: async (jobId: string, target: AddTarget, tracks: Track[], options?) => {
      await whenReady()
      const p = providers[target.service]
      const playlistId =
        'create' in target
          ? (await p.createPlaylist(target.create.name, target.create.description)).id
          : target.playlistId
      const res = await p.addTracks(
        playlistId,
        tracks,
        (done) => progress({ jobId, phase: 'adding', done, total: tracks.length }),
        options?.allowDuplicates
      )
      progress({ jobId, phase: 'done', done: tracks.length, total: tracks.length })
      return { playlistId, ...res }
    },

    searchTracks: async (s: Service, query: string) => (await whenReady(), providers[s].search(query)),
    saveMatch: async (source, target, match) => {
      await whenReady()
      await setMatches([{ source, target, match }])
    },
    peekMatches: async (target, sources) => {
      await whenReady()
      return sources.map((s) => (s.service === target ? null : (getMatch(s, target) ?? null)))
    },

    undo: async (entryId: string) => {
      await whenReady()
      const entry = getHistory().find((e) => e.id === entryId)
      if (!entry) throw new Error('Ajout introuvable dans l’historique.')
      if (entry.undone) return entry
      if (!entry.added) throw new Error('Cet ajout n’a rien ajouté.')
      const { playlistId, tracks } = await tracksOf(providers[entry.target.service], entry)
      await providers[entry.target.service].removeTracks(playlistId, tracks)
      const next = await updateHistory(entry.id, { undone: true, playlistId, addedTracks: tracks })
      if (!next) throw new Error('Ajout introuvable dans l’historique.')
      return next
    },

    history: async () => (await whenReady(), getHistory()),
    recordHistory: async (entry: HistoryEntry) => {
      await whenReady()
      await addHistory(entry)
    },
    clearHistory: async () => {
      await whenReady()
      await clearHistory()
    },

    exportCsv: async (filename, csv) => {
      const result = await invoke<ExportResult>('export_csv', { filename, csv })
      return result
    },

    openExternal: async (url: string) => {
      if (/^https:\/\//.test(url)) await openUrl(url)
    },
    onProgress: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
