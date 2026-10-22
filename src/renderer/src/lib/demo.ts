import type { BridgeApi } from '@shared/api'
import { sortPlaylists } from '@shared/library'
import { bestCandidate, matchesQuery, sameTrack } from '@shared/matching'
import {
  LIKED_ID,
  type AppSettings,
  type HistoryEntry,
  type Playlist,
  type ProgressEvent,
  type Resolution,
  type Service,
  type Track
} from '@shared/types'

/*
 * Données factices pour tester l'interface sans comptes connectés
 * (npm run demo, et la preview hébergée).
 */

const cover = (seed: number): string => {
  const hues = [12, 48, 165, 200, 255, 290, 330]
  const h = hues[seed % hues.length]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='hsl(${h} 45% 38%)'/><circle cx='${10 + ((seed * 7) % 22)}' cy='${12 + ((seed * 5) % 18)}' r='${8 + (seed % 9)}' fill='hsl(${(h + 40) % 360} 60% 62%)' opacity='.85'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// titre, artiste(s), album, durée (s), ISRC
const catalog: [string, string, string, number, string][] = [
  ['Midnight City', 'M83', 'Hurry Up, We’re Dreaming', 243, 'FR6V81141061'],
  ['Get Lucky (feat. Pharrell Williams)', 'Daft Punk', 'Random Access Memories', 369, 'USQX91300108'],
  ['Pyramid Song', 'Radiohead', 'Amnesiac', 289, 'GBAYE0100561'],
  ['Alors on danse', 'Stromae', 'Cheese', 207, 'BEK141000105'],
  ['Retrograde', 'James Blake', 'Overgrown', 223, 'GBUM71301160'],
  ['Nights', 'Frank Ocean', 'Blonde', 307, 'USUYG1104181'],
  ['La Grenade', 'Clara Luciani', 'Sainte-Victoire', 215, 'FR9W11800231'],
  ['Redbone', 'Childish Gambino', 'Awaken, My Love!', 327, 'USYAH1600107'],
  ['Teardrop', 'Massive Attack', 'Mezzanine', 330, 'GBAAA9800002'],
  ['Comme des enfants', 'Cœur de pirate', 'Cœur de pirate', 172, 'CAB370800012'],
  ['Hyperballad', 'Björk', 'Post', 321, 'GBAJE9500001'],
  ['Sweet Disposition', 'The Temper Trap', 'Conditions', 233, 'AUUM70900019'],
  ['Tous les mêmes', 'Stromae', 'Racine carrée', 213, 'BEK141300202'],
  ['Motion Sickness', 'Phoebe Bridgers', 'Stranger in the Alps', 230, 'USJ5G1702008'],
  ['Les Passantes', 'Georges Brassens', 'Fernande', 242, 'FRZ117200150'],
  ['Breathe', 'Télépopmusik', 'Genetic World', 279, 'FRZ200100561'],
  ['Une Belle Histoire', 'Michel Fugain', 'Fais comme l’oiseau', 165, 'FRZ017200042'],
  ['Dans la ville', 'Bon Entendeur', 'Le Rêve', 198, 'FR6V82000310'],
  ['Pink + White', 'Frank Ocean', 'Blonde', 184, 'USUYG1104173'],
  ['Pompeii', 'Bastille', 'Bad Blood', 214, 'GBUM71205526'],
  ['Le Temps est bon', 'Isabelle Pierre', 'Le Temps est bon', 204, 'CAA557100011'],
  ['Bloodbuzz Ohio', 'The National', 'High Violet', 276, 'GBBKS1000021'],
  ['Juicy', 'Doja Cat', 'Hot Pink', 202, 'USRC11902455'],
  ['Clair de lune', 'Claude Debussy, Alexis Weissenberg', 'Suite bergamasque', 300, 'DEF058530010']
]

const mk = (service: Service, i: number, overrides: Partial<Track> = {}): Track => {
  const [title, artist, album, sec, isrc] = catalog[i]
  return {
    id: `${service}-${i}`,
    service,
    uri: service === 'spotify' ? `spotify:track:demo${i}` : undefined,
    title,
    artists: artist.split(', '),
    album,
    durationMs: sec * 1000,
    isrc,
    cover: cover(i),
    ...overrides
  }
}

const pools: Record<Service, Track[]> = {
  spotify: catalog.map((_, i) => mk('spotify', i)),
  tidal: [
    ...catalog.map((_, i) =>
      i === 1
        ? mk('tidal', i, { title: 'Get Lucky', artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'] })
        : // Redbone n'existe sur TIDAL qu'en version live : introuvable automatiquement,
          // mais on peut la choisir à la main
          i === 7
          ? mk('tidal', i, { title: 'Redbone', version: 'Live from Glastonbury', durationMs: 372_000, isrc: 'USYAH1700990' })
          : mk('tidal', i)
    ),
    mk('tidal', 1, { id: 'tidal-1-edit', title: 'Get Lucky', version: 'Radio Edit', durationMs: 248_000, isrc: 'USQX91300104' }),
    mk('tidal', 4, { id: 'tidal-4-live', title: 'Retrograde', version: 'Live', durationMs: 241_000, isrc: 'GBUM71400220' })
  ]
}
const byId = (s: Service, i: number): Track => pools[s].find((t) => t.id === `${s}-${i}`)!

const liked = (service: Service, name: string): Playlist => ({ id: LIKED_ID, kind: 'liked', service, name, editable: true })

const playlists: Record<Service, Playlist[]> = {
  spotify: [
    liked('spotify', 'Titres likés'),
    { id: 'sp-1', service: 'spotify', name: 'Route de nuit', cover: cover(3), editable: true },
    { id: 'sp-2', service: 'spotify', name: 'Dimanche matin', cover: cover(5), editable: true },
    { id: 'sp-3', service: 'spotify', name: 'Chanson française', cover: cover(9), editable: true }
  ],
  tidal: [
    liked('tidal', 'Titres favoris'),
    { id: 'td-1', service: 'tidal', name: 'Night drive', cover: cover(4), editable: true },
    { id: 'td-2', service: 'tidal', name: 'Chill FR', cover: cover(6), editable: true },
    { id: 'td-3', service: 'tidal', name: 'Dimanche matin', cover: cover(12), editable: true },
    { id: 'td-mix', service: 'tidal', name: 'Octobre 2025', cover: cover(8), editable: false },
    { id: 'td-discovery', service: 'tidal', name: 'Septembre 2025', cover: cover(15), editable: false }
  ]
}

const contents: Record<string, Track[]> = {
  [`spotify:${LIKED_ID}`]: [5, 18, 22, 7, 12, 19, 13, 0].map((i) => byId('spotify', i)),
  'spotify:sp-1': [0, 1, 2, 3, 4, 5, 6, 7, 3, 8, 9].map((i) => byId('spotify', i)),
  'spotify:sp-2': [9, 10, 14, 16, 17, 6, 23].map((i) => byId('spotify', i)),
  'spotify:sp-3': [3, 6, 9, 12, 14, 16, 20].map((i) => byId('spotify', i)),
  [`tidal:${LIKED_ID}`]: [5, 22, 21, 0].map((i) => byId('tidal', i)),
  'tidal:td-1': [0, 1, 2, 4, 15, 11, 13, 10].map((i) => byId('tidal', i)),
  'tidal:td-2': [3, 6, 12, 14, 17].map((i) => byId('tidal', i)),
  'tidal:td-3': [9, 10, 21].map((i) => byId('tidal', i)),
  'tidal:td-mix': [2, 7, 11, 15, 18].map((i) => byId('tidal', i)),
  'tidal:td-discovery': [4, 8, 16, 19, 23].map((i) => byId('tidal', i))
}
const countOf = (p: Playlist): Playlist => ({ ...p, trackCount: contents[`${p.service}:${p.id}`]?.length ?? 0 })

const days = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()
let history: HistoryEntry[] = [
  {
    id: 'h2',
    date: days(1),
    mode: 'single',
    source: { service: 'spotify', name: 'Chanson française' },
    target: { service: 'tidal', name: 'Chill FR' },
    added: 2,
    alreadyThere: 0,
    playlistId: 'td-2',
    addedTracks: [{ id: 'tidal-3' }, { id: 'tidal-6' }],
    notFound: [{ title: 'Le Temps est bon', artists: ['Isabelle Pierre'], album: 'Le Temps est bon', isrc: 'CAA557100011', durationMs: 204_000 }]
  },
  {
    id: 'h1',
    date: days(6),
    mode: 'batch',
    source: { service: 'tidal', name: 'Titres favoris' },
    target: { service: 'spotify', name: 'Titres likés' },
    added: 3,
    alreadyThere: 1,
    notFound: []
  }
]

const matches = new Map<string, Track>()
const matchKey = (t: Track, target: Service): string => `${t.service}:${t.id}>${target}`
// Une correspondance vaut dans les deux sens
const remember = (source: Track, target: Service, match: Track): void => {
  matches.set(matchKey(source, target), match)
  matches.set(matchKey(match, source.service), source)
}

let settings: AppSettings = { spotifyClientId: 'demo', tidalClientId: 'demo', tidalCountry: 'FR', tidalScopes: '' }
const listeners = new Set<(e: ProgressEvent) => void>()
const emit = (e: ProgressEvent): void => listeners.forEach((l) => l(e))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let created = 0

export const demoApi: BridgeApi = {
  getSettings: async () => settings,
  saveSettings: async (p) => (settings = { ...settings, ...p }),
  redirectUri: async () => 'http://127.0.0.1:8888/callback',
  accounts: async () => [
    { service: 'spotify', configured: true, connected: true, displayName: 'elouan' },
    { service: 'tidal', configured: true, connected: true, displayName: 'Elouan B.' }
  ],
  connect: async (s) => ({ service: s, configured: true, connected: true, displayName: 'démo' }),
  disconnect: async () => undefined,

  playlists: async (s) => {
    await wait(250)
    return sortPlaylists(playlists[s].map(countOf))
  },
  tracks: async (s, id) => {
    await wait(300)
    return [...(contents[`${s}:${id}`] ?? [])]
  },

  resolve: async (jobId, target, sources, targetTracks) => {
    const out: Resolution[] = []
    const there = (t: Track): boolean => targetTracks.some((x) => x.id === t.id || sameTrack(x, t) !== null)
    for (const [n, { key, track }] of sources.entries()) {
      await wait(70)
      emit({ jobId, phase: 'resolving', done: n + 1, total: sources.length })
      const remembered = track.service === target ? track : matches.get(matchKey(track, target))
      const best = remembered ? { track: remembered, score: 1 } : bestCandidate(track, pools[target])
      if (!best) {
        out.push({ sourceKey: key, status: 'not-found' })
        continue
      }
      if (!remembered) remember(track, target, best.track)
      out.push({
        sourceKey: key,
        status: there(best.track) ? 'already-there' : 'found',
        match: best.track,
        method: remembered && track.service !== target ? 'cache' : track.isrc && best.track.isrc === track.isrc ? 'search-isrc' : 'search-text',
        confidence: best.score
      })
    }
    return out
  },

  searchTracks: async (s, query) => {
    await wait(250)
    const words = query.split(/\s+/).filter(Boolean)
    return pools[s].filter((t) => words.some((w) => w.length > 2 && matchesQuery(w, t))).slice(0, 10)
  },
  saveMatch: async (source, target, match) => remember(source, target, match),
  peekMatches: async (target, sources) => sources.map((s) => (s.service === target ? null : (matches.get(matchKey(s, target)) ?? null))),

  add: async (jobId, target, tracks) => {
    for (let i = 1; i <= tracks.length; i++) {
      await wait(50)
      emit({ jobId, phase: 'adding', done: i, total: tracks.length })
    }
    emit({ jobId, phase: 'done', done: tracks.length, total: tracks.length })
    let playlistId: string
    if ('create' in target) {
      playlistId = `${target.service}-new-${++created}`
      playlists[target.service].splice(1, 0, { id: playlistId, service: target.service, name: target.create.name, editable: true })
    } else playlistId = target.playlistId
    const key = `${target.service}:${playlistId}`
    // En bas, dans l'ordre de la source
    contents[key] = [...(contents[key] ?? []), ...tracks]
    const listed = playlists[target.service].find((p) => p.id === playlistId)
    if (listed) listed.updatedAt = new Date().toISOString()
    return {
      playlistId,
      added: tracks.length,
      skipped: 0,
      tracks: tracks.map((t) => ({ id: t.id, uri: t.uri }))
    }
  },

  undo: async (entryId) => {
    const entry = history.find((e) => e.id === entryId)
    if (!entry) throw new Error('Ajout introuvable dans l’historique.')
    if (entry.undone) return entry
    const playlistId = entry.playlistId
    if (playlistId && entry.addedTracks?.length) {
      const key = `${entry.target.service}:${playlistId}`
      const ids = new Set(entry.addedTracks.map((t) => t.id))
      contents[key] = (contents[key] ?? []).filter((t) => !ids.has(t.id))
    }
    history = history.map((e) => (e.id === entryId ? { ...e, undone: true } : e))
    return history.find((e) => e.id === entryId)!
  },

  history: async () => history,
  recordHistory: async (e) => void (history = [e, ...history]),
  clearHistory: async () => void (history = []),

  // La preview ne peut pas télécharger de fichier : on copie le CSV
  exportCsv: async (_name, csv) => {
    try {
      await navigator.clipboard.writeText(csv)
      return 'copied'
    } catch {
      return 'unavailable'
    }
  },

  // Un vrai lien <a> : window.open est bloqué dans certains contextes embarqués
  openExternal: async (url) => {
    const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener' })
    a.click()
  },
  onProgress: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }
}
