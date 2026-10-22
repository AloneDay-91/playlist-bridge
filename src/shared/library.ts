import type { Playlist, Track } from './types'

/** Titres likés en tête, puis playlists datées de la plus ancienne à la plus récente. */
export function sortPlaylists(list: Playlist[]): Playlist[] {
  const liked = list.filter((p) => p.kind === 'liked')
  const rest = list.filter((p) => p.kind !== 'liked')
  const dated = rest
    .filter((p) => p.updatedAt)
    .sort((a, b) => (a.updatedAt! < b.updatedAt! ? -1 : a.updatedAt! > b.updatedAt! ? 1 : 0))
  const plain = rest.filter((p) => !p.updatedAt)
  return [...liked, ...dated, ...plain]
}

/**
 * Titres ajoutés en fin de playlist autour de `at` (date de l'historique).
 * On ne retient le bloc que s'il a exactement `expected` titres : sinon on ne retire rien.
 */
export function addedSuffix(tracks: Track[], at: string, expected: number): Track[] | null {
  const end = Date.parse(at)
  if (!Number.isFinite(end) || expected <= 0) return null
  const start = end - 3 * 60 * 1000
  const late = end + 30 * 1000
  const suffix: Track[] = []
  for (let i = tracks.length - 1; i >= 0; i--) {
    const ts = Date.parse(tracks[i].addedAt ?? '')
    if (!Number.isFinite(ts) || ts < start || ts > late) break
    suffix.push(tracks[i])
  }
  suffix.reverse()
  return suffix.length === expected ? suffix : null
}
