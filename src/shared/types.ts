export type Service = 'spotify' | 'tidal'

export const SERVICE_LABEL: Record<Service, string> = {
  spotify: 'Spotify',
  tidal: 'TIDAL'
}

export interface Track {
  /** Identifiant natif sur la plateforme */
  id: string
  service: Service
  /** URI Spotify (spotify:track:…) — absent côté TIDAL */
  uri?: string
  title: string
  /** Version séparée (TIDAL : « Remastered 2011 », « Live »…) */
  version?: string
  artists: string[]
  album?: string
  durationMs: number
  isrc?: string | null
  cover?: string
  explicit?: boolean
  addedAt?: string
}

/** Identifiant de la playlist virtuelle « titres likés / favoris » */
export const LIKED_ID = 'liked'

export interface Playlist {
  id: string
  service: Service
  /** 'liked' = titres likés (Spotify) / titres favoris (TIDAL) */
  kind?: 'liked'
  name: string
  description?: string
  trackCount?: number
  cover?: string
  /** true si l'utilisateur peut y ajouter des titres */
  editable: boolean
  /** Dernière modification, pour trier du plus récent au plus ancien */
  updatedAt?: string
}

export interface AccountStatus {
  service: Service
  configured: boolean
  connected: boolean
  displayName?: string
}

/**
 * Scopes third-party qui ouvrent les playlists et les favoris.
 * `user.read` et `search.read` ne sont pas dedans : s’ils ne sont pas activés
 * sur l’app TIDAL, le login entier est refusé (erreur 1002).
 * `r_usr` et `w_usr` sont internes, il ne faut pas les demander.
 */
export const TIDAL_SCOPES = 'playlists.read playlists.write collection.read collection.write'

export interface AppSettings {
  spotifyClientId: string
  tidalClientId: string
  /** Pays utilisé pour le catalogue TIDAL (ISO alpha-2) */
  tidalCountry: string
  /** Scopes TIDAL demandés au login (séparés par des espaces) */
  tidalScopes: string
}

/** Comment un titre a été rapproché d'un autre */
export type MatchMethod = 'isrc' | 'metadata' | 'search-isrc' | 'search-text' | 'manual' | 'cache'

export type RowStatus =
  | 'both' //            présent des deux côtés
  | 'missing' //         présent à gauche, pas à droite → candidat à l'ajout
  | 'extra' //           présent à droite seulement
  | 'duplicate' //       doublon dans la playlist source

export interface CompareRow {
  key: string
  status: RowStatus
  left?: Track
  right?: Track
  method?: MatchMethod
}

export interface CompareResult {
  rows: CompareRow[]
  stats: { both: number; missing: number; extra: number; duplicate: number }
}

/** Résolution d'un titre source sur la plateforme cible */
export interface Resolution {
  sourceKey: string
  status: 'found' | 'not-found' | 'already-there'
  match?: Track
  method?: MatchMethod
  /** 0..1, confiance du rapprochement */
  confidence?: number
  error?: string
}

export interface PlaylistRef {
  service: Service
  id: string
}

/** Où ajouter : une playlist existante ou une nouvelle à créer */
export type AddTarget =
  | { service: Service; playlistId: string }
  | { service: Service; create: { name: string; description?: string } }

export interface ProgressEvent {
  jobId: string
  phase: 'loading' | 'resolving' | 'adding' | 'done' | 'error'
  done: number
  total: number
  message?: string
}

export interface AddedTrack {
  id: string
  uri?: string
}

export interface AddResult {
  playlistId: string
  added: number
  skipped: number
  /** Titres réellement ajoutés, dans l'ordre de la source */
  tracks: AddedTrack[]
}

/** Une entrée d'historique = un ajout vers une playlist */
export interface HistoryEntry {
  id: string
  /** ISO 8601 */
  date: string
  mode: 'single' | 'batch' | 'two-way'
  source: { service: Service; name: string }
  target: { service: Service; name: string }
  added: number
  alreadyThere: number
  notFound: Pick<Track, 'title' | 'artists' | 'album' | 'isrc' | 'durationMs'>[]
  /** Playlist cible, pour pouvoir retirer l'ajout */
  playlistId?: string
  /** Titres ajoutés lors de ce transfert. Absent sur les anciens historiques. */
  addedTracks?: AddedTrack[]
  undone?: boolean
}

export type ExportResult = 'saved' | 'copied' | 'cancelled' | 'unavailable'
