import { bestCandidate, sameTrack, searchTitle } from '@shared/matching'
import type { MatchMethod, Resolution, Track } from '@shared/types'
import { mapLimit } from './http'
import type { MusicProvider } from './providers/types'
import { getMatch, setMatches } from './store'

/**
 * Pour chaque titre source, cherche son équivalent sur la plateforme cible :
 * 1. même plateforme → on réutilise l'ID tel quel
 * 2. recherche par ISRC
 * 3. recherche texte titre + artiste, avec un score de similarité
 * Puis on vérifie qu'il n'est pas déjà dans la playlist cible (anti-doublon).
 * Les correspondances trouvées (ou corrigées à la main) sont mémorisées :
 * une resynchro plus tard ne refait pas la recherche.
 */
export async function resolveTracks(
  target: MusicProvider,
  sources: { key: string; track: Track }[],
  targetTracks: Track[],
  onProgress: (done: number) => void
): Promise<Resolution[]> {
  const targetIds = new Set(targetTracks.map((t) => t.id))
  const alreadyThere = (t: Track): boolean =>
    targetIds.has(t.id) || targetTracks.some((x) => sameTrack(x, t) !== null)

  let done = 0
  const learned: { source: Track; target: typeof target.service; match: Track }[] = []
  const out = await mapLimit(sources, 3, async ({ key, track }): Promise<Resolution> => {
    try {
      if (track.service === target.service) {
        return {
          sourceKey: key,
          status: alreadyThere(track) ? 'already-there' : 'found',
          match: track,
          confidence: 1
        }
      }

      const remembered = getMatch(track, target.service)
      if (remembered) {
        return {
          sourceKey: key,
          status: alreadyThere(remembered) ? 'already-there' : 'found',
          match: remembered,
          method: 'cache',
          confidence: 1
        }
      }

      let best: { track: Track; score: number } | null = null
      let method: MatchMethod = 'search-isrc'
      if (track.isrc) best = bestCandidate(track, await target.searchByIsrc(track.isrc))
      if (!best) {
        method = 'search-text'
        best = bestCandidate(track, await target.searchText(searchTitle(track), track.artists[0] ?? ''))
      }
      if (!best) return { sourceKey: key, status: 'not-found' }

      learned.push({ source: track, target: target.service, match: best.track })
      return {
        sourceKey: key,
        status: alreadyThere(best.track) ? 'already-there' : 'found',
        match: best.track,
        method,
        confidence: best.score
      }
    } catch (e) {
      return { sourceKey: key, status: 'not-found', error: (e as Error).message }
    } finally {
      onProgress(++done)
    }
  })
  setMatches(learned)
  return out
}
