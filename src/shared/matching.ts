import type { CompareResult, CompareRow, MatchMethod, Track } from './types'

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

// NFKD sépare les accents (qu'on retire) ; les ligatures œ / æ se déplient à la main
const stripAccents = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')

/**
 * Titre comparable entre plateformes.
 * Spotify colle la version dans le nom (« Song - 2011 Remaster »), TIDAL la met
 * dans un champ à part. On retire les featurings et les mentions de remaster,
 * mais on GARDE live / remix / acoustic / edit : ce sont d'autres enregistrements.
 */
export function normalizeTitle(title: string, version?: string): string {
  let s = stripAccents(version ? `${title} - ${version}` : title).toLowerCase()
  // (feat. X) [ft. X] (with X)
  s = s.replace(/\s*[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
  // " - feat. X" en fin de titre
  s = s.replace(/\s+-\s+(feat\.?|ft\.?|featuring)\s.*$/, '')
  // " - 2011 Remaster", " - Remastered Version", "(Remastered 2009)"
  s = s.replace(/\s+-\s+[^-]*remaster(ed)?[^-]*$/g, '')
  s = s.replace(/\s*[([][^)\]]*remaster(ed)?[^)\]]*[)\]]/g, '')
  // Seul « remaster » restant après un tiret (cas TIDAL title + version)
  s = s.replace(/\s+-\s*$/, '')
  s = s.replace(/&/g, ' and ')
  return s.replace(/[^a-z0-9]+/g, ' ').trim()
}

export function normalizeArtist(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Découpe « A, B & C » / « A feat. B » en artistes individuels */
export function splitArtists(artists: string[]): string[] {
  return artists
    .flatMap((a) => a.split(/\s*(?:,|;|\s&\s|\sfeat\.?\s|\sft\.?\s|\sx\s)\s*/i))
    .map(normalizeArtist)
    .filter(Boolean)
}

export const isrcOf = (t: Track): string | undefined =>
  t.isrc ? t.isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : undefined

export const metaKey = (t: Track): string =>
  `${normalizeTitle(t.title, t.version)}|${splitArtists(t.artists)[0] ?? ''}`

/* ------------------------------------------------------------------ */
/* Rapprochement de deux titres                                        */
/* ------------------------------------------------------------------ */

const DURATION_TOLERANCE_MS = 4000

function artistsOverlap(a: Track, b: Track): boolean {
  const A = new Set(splitArtists(a.artists))
  return splitArtists(b.artists).some((x) => A.has(x))
}

function durationClose(a: Track, b: Track, tol = DURATION_TOLERANCE_MS): boolean {
  if (!a.durationMs || !b.durationMs) return true
  return Math.abs(a.durationMs - b.durationMs) <= tol
}

/**
 * Deux titres sont-ils le même morceau ?
 * - même ISRC → oui
 * - sinon même titre normalisé + un artiste en commun + durée à ±4 s → oui
 *   (couvre les rééditions single/album qui ont des ISRC différents)
 */
export function sameTrack(a: Track, b: Track): MatchMethod | null {
  const ia = isrcOf(a)
  const ib = isrcOf(b)
  if (ia && ib && ia === ib) return 'isrc'
  if (
    normalizeTitle(a.title, a.version) === normalizeTitle(b.title, b.version) &&
    artistsOverlap(a, b) &&
    durationClose(a, b)
  ) {
    return 'metadata'
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Score d'un résultat de recherche                                    */
/* ------------------------------------------------------------------ */

function tokens(s: string): Set<string> {
  return new Set(s.split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 0..1 — à quel point `candidate` ressemble à `source` */
export function matchScore(source: Track, candidate: Track): number {
  const si = isrcOf(source)
  const ci = isrcOf(candidate)
  if (si && ci && si === ci) return 1

  const st = normalizeTitle(source.title, source.version)
  const ct = normalizeTitle(candidate.title, candidate.version)
  const titleScore = st === ct ? 1 : jaccard(tokens(st), tokens(ct))

  const sa = splitArtists(source.artists)
  const ca = new Set(splitArtists(candidate.artists))
  const artistScore = sa.length ? sa.filter((a) => ca.has(a)).length / sa.length : 0

  let durationScore = 0.5
  if (source.durationMs && candidate.durationMs) {
    const diff = Math.abs(source.durationMs - candidate.durationMs)
    durationScore = diff <= 2000 ? 1 : diff <= 5000 ? 0.7 : diff <= 15000 ? 0.3 : 0
  }

  return titleScore * 0.5 + Math.min(1, artistScore * 1.5) * 0.3 + durationScore * 0.2
}

export const MATCH_THRESHOLD = 0.78

export function bestCandidate(
  source: Track,
  candidates: Track[]
): { track: Track; score: number } | null {
  let best: { track: Track; score: number } | null = null
  for (const c of candidates) {
    const score = matchScore(source, c)
    if (!best || score > best.score) best = { track: c, score }
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null
}

/** Titre « propre » pour une recherche texte (sans feat ni remaster) */
export function searchTitle(t: Pick<Track, 'title' | 'version'>): string {
  const base = t.title
    .replace(/\s*[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*remaster.*$/i, '')
    .replace(/\s*[([][^)\]]*remaster[^)\]]*[)\]]/gi, '')
  const v = t.version && !/remaster/i.test(t.version) ? ` ${t.version}` : ''
  return (base + v).trim()
}

/** Texte de recherche par défaut pour retrouver un titre ailleurs */
export const searchQueryFor = (t: Pick<Track, 'title' | 'version' | 'artists'>): string =>
  `${searchTitle(t)} ${t.artists[0] ?? ''}`.trim()

/** Recherche plein texte locale (filtre de la liste) */
export function matchesQuery(q: string, ...tracks: (Track | undefined)[]): boolean {
  const needle = stripAccents(q).toLowerCase().trim()
  if (!needle) return true
  return tracks.some(
    (t) => !!t && stripAccents(`${t.title} ${t.version ?? ''} ${t.artists.join(' ')} ${t.album ?? ''}`).toLowerCase().includes(needle)
  )
}

/* ------------------------------------------------------------------ */
/* Comparaison de deux playlists                                       */
/* ------------------------------------------------------------------ */

class TrackIndex {
  private byIsrc = new Map<string, Track[]>()
  private byTitle = new Map<string, Track[]>()

  add(t: Track): void {
    const i = isrcOf(t)
    if (i) push(this.byIsrc, i, t)
    push(this.byTitle, normalizeTitle(t.title, t.version), t)
  }

  find(t: Track): { track: Track; method: MatchMethod } | null {
    const i = isrcOf(t)
    if (i) {
      const hit = this.byIsrc.get(i)?.[0]
      if (hit) return { track: hit, method: 'isrc' }
    }
    for (const c of this.byTitle.get(normalizeTitle(t.title, t.version)) ?? []) {
      const m = sameTrack(t, c)
      if (m) return { track: c, method: m }
    }
    return null
  }
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V): void {
  const arr = map.get(k)
  if (arr) arr.push(v)
  else map.set(k, [v])
}

export const rowKey = (t: Track): string => `${t.service}:${t.id}`

/**
 * Compare la playlist `left` (source) à `right` (cible).
 * Les doublons internes à la source sont signalés une seule fois.
 */
export function comparePlaylists(left: Track[], right: Track[]): CompareResult {
  const rightIndex = new TrackIndex()
  right.forEach((t) => rightIndex.add(t))

  const seenLeft = new TrackIndex()
  const matchedRight = new Set<string>()
  const rows: CompareRow[] = []

  left.forEach((t, i) => {
    const key = `${rowKey(t)}#${i}`
    if (seenLeft.find(t)) {
      rows.push({ key, status: 'duplicate', left: t })
      return
    }
    seenLeft.add(t)

    const hit = rightIndex.find(t)
    if (hit) {
      matchedRight.add(rowKey(hit.track))
      rows.push({ key, status: 'both', left: t, right: hit.track, method: hit.method })
    } else {
      rows.push({ key, status: 'missing', left: t })
    }
  })

  right.forEach((t, i) => {
    if (!matchedRight.has(rowKey(t))) {
      rows.push({ key: `${rowKey(t)}#r${i}`, status: 'extra', right: t })
    }
  })

  const stats = { both: 0, missing: 0, extra: 0, duplicate: 0 }
  for (const r of rows) stats[r.status]++
  return { rows, stats }
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

/** « PT3M5S » → 185000 */
export function parseIsoDuration(iso: string | undefined | null): number {
  if (!iso) return 0
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso)
  if (!m) return 0
  const [, d, h, min, s] = m
  return Math.round(
    ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)) * 1000
  )
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
