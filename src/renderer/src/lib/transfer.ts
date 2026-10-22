import type { HistoryEntry, Playlist, Resolution, Service, Track } from '@shared/types'

export const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Construit une entrée d'historique à partir des résolutions d'un ajout */
export function historyEntry(opts: {
  mode: HistoryEntry['mode']
  source: { service: Service; name: string }
  target: { service: Service; name: string }
  added: number
  resolutions: Resolution[]
  sources: Map<string, Track>
}): HistoryEntry {
  const notFound = opts.resolutions
    .filter((r) => r.status === 'not-found')
    .map((r) => opts.sources.get(r.sourceKey))
    .filter((t): t is Track => !!t)
    .map(({ title, artists, album, isrc, durationMs }) => ({ title, artists, album, isrc, durationMs }))
  return {
    id: newId(),
    date: new Date().toISOString(),
    mode: opts.mode,
    source: opts.source,
    target: opts.target,
    added: opts.added,
    alreadyThere: opts.resolutions.filter((r) => r.status === 'already-there').length,
    notFound
  }
}

const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Playlist cible équivalente : les likés vont dans les likés, sinon même nom */
export function findCounterpart(source: Playlist, candidates: Playlist[]): Playlist | undefined {
  if (source.kind === 'liked') return candidates.find((p) => p.kind === 'liked')
  return candidates.find((p) => p.editable && p.kind !== 'liked' && norm(p.name) === norm(source.name))
}
