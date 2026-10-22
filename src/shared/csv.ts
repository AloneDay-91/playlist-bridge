import { formatDuration } from './matching'
import { SERVICE_LABEL, type CompareRow, type HistoryEntry, type Resolution, type Service, type Track } from './types'

/* CSV au format attendu par Excel / Numbers en français : séparateur « ; » */

const cell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map(cell).join(';')).join('\r\n')

export function trackUrl(t: Pick<Track, 'service' | 'id'>): string {
  return t.service === 'spotify'
    ? `https://open.spotify.com/track/${t.id}`
    : `https://tidal.com/browse/track/${t.id}`
}

const STATUS_LABEL: Record<string, string> = {
  both: 'En commun',
  missing: 'Manquant dans la cible',
  extra: 'Seulement dans la cible',
  duplicate: 'Doublon dans la source',
  found: 'Trouvé',
  'not-found': 'Introuvable',
  'already-there': 'Déjà présent'
}

const trackCols = (t?: Track): unknown[] =>
  t ? [t.title + (t.version ? ` (${t.version})` : ''), t.artists.join(', '), t.album, formatDuration(t.durationMs), t.isrc, trackUrl(t)] : ['', '', '', '', '', '']

/** Export d'une comparaison : une ligne par titre, source et cible côte à côte */
export function compareToCsv(
  rows: CompareRow[],
  resolutions: Map<string, Resolution>,
  left: Service,
  right?: Service
): string {
  const L = SERVICE_LABEL[left]
  const R = right ? SERVICE_LABEL[right] : 'Cible'
  const head = [
    'Statut',
    'Recherche',
    ...['Titre', 'Artistes', 'Album', 'Durée', 'ISRC', 'Lien'].map((c) => `${c} (${L})`),
    ...['Titre', 'Artistes', 'Album', 'Durée', 'ISRC', 'Lien'].map((c) => `${c} (${R})`)
  ]
  const body = rows.map((r) => {
    const res = resolutions.get(r.key)
    const other = r.right ?? res?.match
    return [
      STATUS_LABEL[r.status],
      res ? STATUS_LABEL[res.status] : '',
      ...trackCols(r.left),
      ...trackCols(r.status === 'extra' ? r.right : other)
    ]
  })
  return toCsv([head, ...body])
}

/** Liste des introuvables d'une ou plusieurs entrées d'historique */
export function notFoundToCsv(entries: HistoryEntry[]): string {
  const head = ['Playlist source', 'Plateforme cible', 'Titre', 'Artistes', 'Album', 'Durée', 'ISRC']
  const body = entries.flatMap((e) =>
    e.notFound.map((t) => [
      e.source.name,
      SERVICE_LABEL[e.target.service],
      t.title,
      t.artists.join(', '),
      t.album,
      formatDuration(t.durationMs),
      t.isrc
    ])
  )
  return toCsv([head, ...body])
}
