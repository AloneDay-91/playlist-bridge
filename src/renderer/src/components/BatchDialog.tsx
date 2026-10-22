import { useEffect, useMemo, useRef, useState } from 'react'
import { notFoundToCsv } from '@shared/csv'
import { comparePlaylists } from '@shared/matching'
import { SERVICE_LABEL, type HistoryEntry, type Playlist, type Service, type Track } from '@shared/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Empty, EmptyDescription, EmptyMedia } from '@/components/ui/Empty'
import { Progress } from '@/components/ui/Progress'
import { Spinner } from '@/components/ui/Spinner'
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/Tabs'
import { api, newJobId } from '@/lib/api'
import { saveCsv } from '@/lib/feedback'
import { findCounterpart, historyEntry } from '@/lib/transfer'
import { cn } from '@/lib/utils'
import { PlaylistCover } from './Cover'
import { Icon, ServiceLogo } from './Icon'

type ItemState = {
  playlist: Playlist
  status: 'waiting' | 'running' | 'done' | 'skipped' | 'error'
  phase?: string
  /** Nom de la playlist d'arrivée, et si elle existait déjà */
  targetName?: string
  merged?: boolean
  added: number
  alreadyThere: number
  notFound: number
  error?: string
}

interface Props {
  open: boolean
  playlists: Record<Service, Playlist[]>
  connected: Service[]
  onClose: () => void
  /** Appelé à la fin pour recharger les playlists de la cible */
  onFinished: (target: Service) => void
}

const other = (s: Service): Service => (s === 'spotify' ? 'tidal' : 'spotify')

export function BatchDialog({ open, playlists, connected, onClose, onFinished }: Props) {
  const [source, setSource] = useState<Service>('spotify')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [merge, setMerge] = useState(true)
  const [step, setStep] = useState<'setup' | 'run' | 'done'>('setup')
  const [items, setItems] = useState<ItemState[]>([])
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const stop = useRef(false)
  const jobs = useRef(new Map<string, number>())

  const target = other(source)
  const ready = connected.includes('spotify') && connected.includes('tidal')
  const list = playlists[source]

  useEffect(() => {
    if (!open) return
    setStep('setup')
    setItems([])
    setEntries([])
    setPicked(new Set())
  }, [open])

  // Progression fine (recherche / ajout) de la playlist en cours
  useEffect(
    () =>
      api.onProgress((e) => {
        const i = jobs.current.get(e.jobId)
        if (i === undefined || e.phase === 'done') return
        const label = e.phase === 'resolving' ? 'Recherche' : e.phase === 'adding' ? 'Ajout' : 'Lecture'
        setItems((cur) => cur.map((it, j) => (j === i ? { ...it, phase: `${label} ${e.done}${e.total ? `/${e.total}` : ''}` } : it)))
      }),
    []
  )

  const update = (i: number, patch: Partial<ItemState>): void =>
    setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  async function run() {
    const chosen = list.filter((p) => picked.has(p.id))
    const initial = chosen.map<ItemState>((p) => ({ playlist: p, status: 'waiting', added: 0, alreadyThere: 0, notFound: 0 }))
    setItems(initial)
    setStep('run')
    stop.current = false
    const done: HistoryEntry[] = []

    for (const [i, src] of chosen.entries()) {
      if (stop.current) {
        update(i, { status: 'skipped', phase: 'Arrêté' })
        continue
      }
      try {
        update(i, { status: 'running', phase: 'Lecture' })
        const loadJob = newJobId()
        jobs.current.set(loadJob, i)
        const srcTracks = await api.tracks(src.service, src.id, loadJob)
        if (!srcTracks.length) {
          update(i, { status: 'skipped', phase: 'Playlist vide' })
          continue
        }

        const counterpart = src.kind === 'liked' || merge ? findCounterpart(src, playlists[target]) : undefined
        const tgtTracks: Track[] = counterpart ? await api.tracks(target, counterpart.id) : []
        const targetName = counterpart?.name ?? src.name
        update(i, { targetName, merged: !!counterpart })

        const missing = comparePlaylists(srcTracks, tgtTracks).rows.filter((r) => r.status === 'missing' && r.left)
        const already = srcTracks.length - missing.length
        if (!missing.length) {
          update(i, { status: 'done', phase: 'Déjà à jour', alreadyThere: already })
          continue
        }

        const resolveJob = newJobId()
        jobs.current.set(resolveJob, i)
        const sources = missing.map((r) => ({ key: r.key, track: r.left! }))
        const res = await api.resolve(resolveJob, target, sources, tgtTracks)
        const found = res.filter((r) => r.status === 'found' && r.match).map((r) => r.match!)

        let added = 0
        if (found.length) {
          const addJob = newJobId()
          jobs.current.set(addJob, i)
          const result = await api.add(
            addJob,
            counterpart
              ? { service: target, playlistId: counterpart.id }
              : { service: target, create: { name: src.name, description: `Depuis ${SERVICE_LABEL[src.service]}` } },
            found
          )
          added = result.added
        }

        const entry = historyEntry({
          mode: 'batch',
          source: { service: src.service, name: src.name },
          target: { service: target, name: targetName },
          added,
          resolutions: res,
          sources: new Map(sources.map((s) => [s.key, s.track]))
        })
        if (added || entry.notFound.length) {
          await api.recordHistory(entry)
          done.push(entry)
        }
        update(i, {
          status: 'done',
          phase: undefined,
          added,
          alreadyThere: already + entry.alreadyThere,
          notFound: entry.notFound.length
        })
      } catch (e) {
        update(i, { status: 'error', phase: undefined, error: (e as Error).message })
      }
    }

    setEntries(done)
    setStep('done')
    onFinished(target)
  }

  const totals = useMemo(
    () =>
      items.reduce(
        (a, it) => ({ added: a.added + it.added, notFound: a.notFound + it.notFound, finished: a.finished + (['done', 'skipped', 'error'].includes(it.status) ? 1 : 0) }),
        { added: 0, notFound: 0, finished: 0 }
      ),
    [items]
  )

  const allPicked = list.length > 0 && list.every((p) => picked.has(p.id))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && step !== 'run' && onClose()}>
      <DialogContent showClose={step !== 'run'} className="max-h-[86vh] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Transfert groupé</DialogTitle>
          <DialogDescription>
            {step === 'setup'
              ? 'Envoie plusieurs playlists d’un coup. Les titres déjà présents ne sont jamais ajoutés deux fois.'
              : step === 'run'
                ? `Transfert vers ${SERVICE_LABEL[target]} en cours. Tu peux laisser la fenêtre ouverte.`
                : `Terminé : ${totals.added} titre${totals.added > 1 ? 's' : ''} ajouté${totals.added > 1 ? 's' : ''}, ${totals.notFound} introuvable${totals.notFound > 1 ? 's' : ''}.`}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <Empty className="row-span-2 py-10">
            <EmptyMedia>
              <Icon name="batch" size={18} />
            </EmptyMedia>
            <EmptyDescription>Connecte Spotify et TIDAL pour transférer des playlists de l’un vers l’autre.</EmptyDescription>
          </Empty>
        ) : step === 'setup' ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={source} onValueChange={(v) => (setSource(v as Service), setPicked(new Set()))}>
                <TabsList>
                  {(['spotify', 'tidal'] as Service[]).map((s) => (
                    <TabsTab key={s} value={s} className="gap-1.5">
                      <ServiceLogo service={s} size={12} />
                      Depuis {SERVICE_LABEL[s]}
                    </TabsTab>
                  ))}
                  <TabsIndicator />
                </TabsList>
              </Tabs>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon name="arrowRight" size={12} /> vers <ServiceLogo service={target} size={12} /> {SERVICE_LABEL[target]}
              </span>
            </div>

            <div className="-mx-2 overflow-y-auto px-2">
              <label className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
                <Checkbox
                  checked={allPicked}
                  onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(list.map((p) => p.id)))}
                />
                Tout sélectionner ({list.length})
              </label>
              {list.map((p) => {
                const counterpart = p.kind === 'liked' || merge ? findCounterpart(p, playlists[target]) : undefined
                return (
                  <label key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      checked={picked.has(p.id)}
                      onCheckedChange={() =>
                        setPicked((cur) => {
                          const n = new Set(cur)
                          if (n.has(p.id)) n.delete(p.id)
                          else n.add(p.id)
                          return n
                        })
                      }
                    />
                    <PlaylistCover playlist={p} size={32} className="rounded-md" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {counterpart ? `Complète « ${counterpart.name} »` : 'Nouvelle playlist'}
                      </span>
                    </span>
                    <span className="tnum text-xs text-muted-foreground">{p.trackCount ?? ''}</span>
                  </label>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <Progress value={items.length ? (totals.finished / items.length) * 100 : 0} />
            <ol className="-mx-2 overflow-y-auto px-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <span className="grid size-5 place-items-center">
                    {it.status === 'running' ? (
                      <Spinner size={14} />
                    ) : it.status === 'done' ? (
                      <Icon name="check" size={14} className="text-both" />
                    ) : it.status === 'error' ? (
                      <Icon name="notFound" size={14} className="text-destructive" />
                    ) : (
                      <span className={cn('size-1.5 rounded-full', it.status === 'skipped' ? 'bg-border' : 'bg-muted-foreground/40')} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm">{it.playlist.name}</span>
                    <span className={cn('block truncate text-xs', it.error ? 'text-destructive' : 'text-muted-foreground')}>
                      {it.error ??
                        it.phase ??
                        (it.status === 'waiting'
                          ? 'En attente'
                          : it.targetName
                            ? `${it.merged ? 'Complète' : 'Crée'} « ${it.targetName} »`
                            : '')}
                    </span>
                  </span>
                  {it.status === 'done' && (
                    <span className="flex shrink-0 gap-1">
                      <Badge variant="secondary" className="tnum">+{it.added}</Badge>
                      {it.notFound > 0 && <Badge variant="destructive" className="tnum">{it.notFound}</Badge>}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        <DialogFooter>
          {step === 'setup' && ready && (
            <>
              <label className="mr-auto flex items-center gap-2 self-center text-xs text-muted-foreground">
                <Checkbox checked={merge} onCheckedChange={(v) => setMerge(!!v)} />
                Compléter les playlists du même nom
              </label>
              <Button disabled={!picked.size} onClick={() => void run()}>
                <Icon name="batch" /> Transférer {picked.size || ''} playlist{picked.size > 1 ? 's' : ''}
              </Button>
            </>
          )}
          {step === 'run' && (
            <Button variant="outline" onClick={() => (stop.current = true)}>
              Arrêter après la playlist en cours
            </Button>
          )}
          {step === 'done' && (
            <>
              {entries.some((e) => e.notFound.length) && (
                <Button
                  variant="outline"
                  className="mr-auto"
                  onClick={() => saveCsv('Introuvables - transfert groupé.csv', notFoundToCsv(entries))}
                >
                  <Icon name="download" /> Introuvables en CSV
                </Button>
              )}
              <Button onClick={onClose}>Fermer</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
