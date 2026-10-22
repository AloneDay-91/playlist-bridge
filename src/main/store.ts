import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, HistoryEntry, Service, Track } from '@shared/types'

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
  tidalScopes: 'user.read playlists.read playlists.write search.read collection.read collection.write'
}

/** Ancienne valeur par défaut : on la met à niveau pour les favoris (collection.write) */
const OLD_TIDAL_SCOPES = 'user.read playlists.read playlists.write search.read collection.read'

const dir = (): string => {
  const d = app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/* ---------------------------- Réglages ---------------------------- */

export function getSettings(): AppSettings {
  const file = join(dir(), 'settings.json')
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS }
  try {
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file, 'utf8')) } as AppSettings
    if (saved.tidalScopes === OLD_TIDAL_SCOPES) saved.tidalScopes = DEFAULT_SETTINGS.tidalScopes
    return saved
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  writeFileSync(join(dir(), 'settings.json'), JSON.stringify(next, null, 2))
  return next
}

/* ----------------------------- Tokens ----------------------------- */
// Chiffrés avec le trousseau de l'OS (Keychain / DPAPI / libsecret) quand dispo.

const tokenFile = (s: Service): string => join(dir(), `token-${s}.bin`)

export function getToken(service: Service): TokenSet | null {
  const file = tokenFile(service)
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return JSON.parse(json) as TokenSet
  } catch {
    return null
  }
}

export function saveToken(service: Service, token: TokenSet | null): void {
  const file = tokenFile(service)
  if (!token) {
    writeFileSync(file, '')
    return
  }
  const json = JSON.stringify(token)
  writeFileSync(
    file,
    safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json)
  )
}

/* --------------------- Fichiers JSON génériques --------------------- */

function readJson<T>(name: string, fallback: T): T {
  const file = join(dir(), name)
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

const writeJson = (name: string, data: unknown): void =>
  writeFileSync(join(dir(), name), JSON.stringify(data))

/* ------------------- Mémoire des correspondances ------------------- */
// « tel titre source = tel titre cible », pour ne pas re-chercher et garder
// les corrections manuelles d'une fois sur l'autre.

const matchKey = (source: Pick<Track, 'service' | 'id'>, target: Service): string =>
  `${source.service}:${source.id}>${target}`

let matchCache: Record<string, Track> | null = null
const matches = (): Record<string, Track> => (matchCache ??= readJson('matches.json', {}))

export function getMatch(source: Track, target: Service): Track | undefined {
  return matches()[matchKey(source, target)]
}

export function setMatches(pairs: { source: Track; target: Service; match: Track }[]): void {
  if (!pairs.length) return
  const m = matches()
  for (const p of pairs) {
    m[matchKey(p.source, p.target)] = p.match
    // Une correspondance vaut dans les deux sens
    m[matchKey(p.match, p.source.service)] = p.source
  }
  writeJson('matches.json', m)
}

/* ---------------------------- Historique ---------------------------- */

const HISTORY_MAX = 300

export const getHistory = (): HistoryEntry[] => readJson<HistoryEntry[]>('history.json', [])

export function addHistory(entry: HistoryEntry): void {
  writeJson('history.json', [entry, ...getHistory()].slice(0, HISTORY_MAX))
}

export const clearHistory = (): void => writeJson('history.json', [])
