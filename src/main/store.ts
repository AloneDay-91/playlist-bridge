import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { TIDAL_SCOPES, type AppSettings, type HistoryEntry, type Service, type Track } from '@shared/types'

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** timestamp ms */
  expiresAt: number
  scope?: string
}

const DEFAULT_SETTINGS: AppSettings = {
  spotifyClientId: '',
  tidalClientId: '',
  // vide = pays du compte TIDAL
  tidalCountry: '',
  tidalScopes: TIDAL_SCOPES
}

/** Anciennes valeurs par défaut : la seconde inclut user.read et search.read, qui bloquent le login. */
const LEGACY_TIDAL_SCOPES = [
  'user.read playlists.read playlists.write search.read collection.read',
  'user.read playlists.read playlists.write search.read collection.read collection.write'
]

const APP_DATA = { baseDir: BaseDirectory.AppData }

/* Les lectures sont synchrones après `whenReady`. Les écritures partent dans une file. */

let settings: AppSettings = { ...DEFAULT_SETTINGS }
const tokens: Partial<Record<Service, TokenSet | null>> = {}
let matchCache: Record<string, Track> = {}
let history: HistoryEntry[] = []

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    if (!(await exists(name, APP_DATA))) return fallback
    return JSON.parse(await readTextFile(name, APP_DATA)) as T
  } catch {
    return fallback
  }
}

const writeJson = (name: string, data: unknown): Promise<void> =>
  enqueue(() => writeTextFile(name, JSON.stringify(data), APP_DATA))

let ready: Promise<void> | null = null

/** Charge réglages, tokens, correspondances et historique avant tout appel API. */
export function whenReady(): Promise<void> {
  ready ??= (async () => {
    await mkdir('.', { ...APP_DATA, recursive: true }).catch(() => undefined)
    const saved = await readJson<Partial<AppSettings>>('settings.json', {})
    settings = { ...DEFAULT_SETTINGS, ...saved }
    // Vide, ou une ancienne liste qui contient un scope non activé : le login TIDAL échoue.
    if (!settings.tidalScopes.trim() || LEGACY_TIDAL_SCOPES.includes(settings.tidalScopes)) {
      settings = { ...settings, tidalScopes: TIDAL_SCOPES }
      await writeJson('settings.json', settings)
    }
    matchCache = await readJson('matches.json', {})
    history = await readJson<HistoryEntry[]>('history.json', [])
    tokens.spotify = await readToken('spotify')
    tokens.tidal = await readToken('tidal')
  })()
  return ready
}

/* ---------------------------- Réglages ---------------------------- */

export const getSettings = (): AppSettings => ({ ...settings })

export function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  settings = { ...settings, ...patch }
  const next = { ...settings }
  return writeJson('settings.json', next).then(() => next)
}

/* ----------------------------- Tokens ----------------------------- */
// Dans le trousseau de l'OS (Keychain / Credential Manager / Secret Service).

async function readToken(service: Service): Promise<TokenSet | null> {
  try {
    const json = await invoke<string | null>('token_get', { service })
    return json ? (JSON.parse(json) as TokenSet) : null
  } catch {
    return null
  }
}

export const getToken = (service: Service): TokenSet | null => tokens[service] ?? null

export function saveToken(service: Service, token: TokenSet | null): Promise<void> {
  tokens[service] = token
  return enqueue(() =>
    token
      ? invoke('token_set', { service, secret: JSON.stringify(token) })
      : invoke('token_delete', { service })
  )
}

/* ------------------- Mémoire des correspondances ------------------- */
// « tel titre source = tel titre cible », pour ne pas re-chercher et garder
// les corrections manuelles d'une fois sur l'autre.

const matchKey = (source: Pick<Track, 'service' | 'id'>, target: Service): string =>
  `${source.service}:${source.id}>${target}`

export function getMatch(source: Track, target: Service): Track | undefined {
  return matchCache[matchKey(source, target)]
}

export function setMatches(pairs: { source: Track; target: Service; match: Track }[]): Promise<void> {
  if (!pairs.length) return Promise.resolve()
  for (const p of pairs) {
    matchCache[matchKey(p.source, p.target)] = p.match
    // Une correspondance vaut dans les deux sens
    matchCache[matchKey(p.match, p.source.service)] = p.source
  }
  return writeJson('matches.json', matchCache)
}

/* ---------------------------- Historique ---------------------------- */

const HISTORY_MAX = 300

export const getHistory = (): HistoryEntry[] => history

export function addHistory(entry: HistoryEntry): Promise<void> {
  history = [entry, ...history].slice(0, HISTORY_MAX)
  return writeJson('history.json', history)
}

export function clearHistory(): Promise<void> {
  history = []
  return writeJson('history.json', history)
}

export function updateHistory(id: string, patch: Partial<HistoryEntry>): Promise<HistoryEntry | null> {
  const i = history.findIndex((e) => e.id === id)
  if (i < 0) return Promise.resolve(null)
  history = history.map((e, n) => (n === i ? { ...e, ...patch } : e))
  return writeJson('history.json', history).then(() => history[i])
}
