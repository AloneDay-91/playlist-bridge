import { useEffect, useRef, useState } from 'react'
import { formatDuration, matchScore, searchQueryFor } from '@shared/matching'
import { SERVICE_LABEL, type Service, type Track } from '@shared/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Cover } from './Cover'
import { Icon, ServiceLogo } from './Icon'

interface Props {
  /** Titre à retrouver ; null = fermé */
  source: Track | null
  target: Service
  current?: Track
  onPick: (match: Track) => void
  onSkip: () => void
  onClose: () => void
}

/** Recherche libre sur la plateforme cible pour choisir soi-même la bonne version */
export function MatchDialog({ source, target, current, onPick, onSkip, onClose }: Props) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (source) setQ(searchQueryFor(source))
  }, [source])

  // Recherche avec un petit délai pendant la frappe
  useEffect(() => {
    if (!source || !q.trim()) return
    const id = ++seq.current
    setResults(null)
    setError(null)
    const t = setTimeout(() => {
      api
        .searchTracks(target, q)
        .then((r) => id === seq.current && setResults(r))
        .catch((e) => id === seq.current && (setError((e as Error).message), setResults([])))
    }, 350)
    return () => clearTimeout(t)
  }, [q, source, target])

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choisir le titre sur {SERVICE_LABEL[target]}</DialogTitle>
          <DialogDescription>Ton choix est mémorisé pour les prochaines synchros.</DialogDescription>
        </DialogHeader>

        {source && (
          <div className="flex items-center gap-3 rounded-2xl bg-muted p-2.5">
            <Cover src={source.cover} size={40} className="rounded-md" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm">{source.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {source.artists.join(', ')}
                {source.album ? `, ${source.album}` : ''}
              </div>
            </div>
            <span className="tnum text-xs text-muted-foreground">{formatDuration(source.durationMs)}</span>
            <ServiceLogo service={source.service} size={14} />
          </div>
        )}

        <div className="relative">
          <Icon name="search" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            id="match-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Rechercher sur ${SERVICE_LABEL[target]}`}
            className="pl-8"
          />
        </div>

        <div className="-mx-2 min-h-24 overflow-y-auto px-2">
          {results === null ? (
            <div className="space-y-2 pt-1">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-2">
                  <Skeleton className="size-9 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {error ?? 'Aucun résultat. Essaie sans le featuring ou avec le nom de l’album.'}
            </p>
          ) : (
            results.map((t) => {
              const score = source ? matchScore(source, t) : 0
              const isCurrent = current?.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => onPick(t)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                    isCurrent && 'bg-muted'
                  )}
                >
                  <Cover src={t.cover} size={36} className="rounded-md" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm">
                      {t.title}
                      {t.version && <span className="text-muted-foreground"> ({t.version})</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.artists.join(', ')}
                      {t.album ? `, ${t.album}` : ''}
                    </span>
                  </span>
                  <span className="tnum text-xs text-muted-foreground">{formatDuration(t.durationMs)}</span>
                  <Badge variant={score >= 0.78 ? 'secondary' : 'outline'} className="tnum w-11 justify-center" title="Ressemblance avec le titre source">
                    {Math.round(score * 100)} %
                  </Badge>
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onSkip}>
            Ne pas ajouter ce titre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
