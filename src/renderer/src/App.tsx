import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareToCsv } from '@shared/csv'
import { comparePlaylists, matchesQuery, sameTrack } from '@shared/matching'
import {
  SERVICE_LABEL,
  type AccountStatus,
  type AddTarget,
  type CompareRow,
  type Playlist,
  type ProgressEvent,
  type Resolution,
  type RowStatus,
  type Service,
  type Track
} from '@shared/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/Empty'
import { Input } from '@/components/ui/Input'
import { Progress } from '@/components/ui/Progress'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { ToastProvider, Toaster } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import { ToggleGroup } from '@/components/ui/ToggleGroup'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { api, isDemo, newJobId } from '@/lib/api'
import { fail, notify, saveCsv, toasts } from '@/lib/feedback'
import { historyEntry } from '@/lib/transfer'
import { cn } from '@/lib/utils'
import { BatchDialog } from './components/BatchDialog'
import { CompareRows, rowDirection, type Direction } from './components/CompareRows'
import { HistoryDialog } from './components/HistoryDialog'
import { Icon } from './components/Icon'
import { MatchDialog } from './components/MatchDialog'
import { PlaylistPicker, type PickResult } from './components/PlaylistPicker'
import { PlaylistSlot } from './components/PlaylistSlot'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'

type Loaded = { playlist: Playlist; tracks: Track[] | null }
type Target = ({ kind: 'existing' } & Loaded) | { kind: 'new'; service: Service; name: string }
type Filter = 'all' | RowStatus

const SERVICES: Service[] = ['spotify', 'tidal']
const NO_TRACKS: Track[] = []
const emptyLists = (): Record<Service, Playlist[]> => ({ spotify: [], tidal: [] })
const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`

export default function App() {
  return (
    <ToastProvider toastManager={toasts}>
      <TooltipProvider>
        <Bridge />
        <Toaster />
      </TooltipProvider>
    </ToastProvider>
  )
}

function Bridge() {
  /* ----------------------------- comptes ----------------------------- */
  const [accounts, setAccounts] = useState<AccountStatus[]>([])
  const [playlists, setPlaylists] = useState(emptyLists)
  const [loadingLists, setLoadingLists] = useState({ spotify: false, tidal: false })
  const [tab, setTab] = useState<Service>('spotify')
  const [dialog, setDialog] = useState<'settings' | 'history' | 'batch' | null>(null)
  // Sur petit écran, la sidebar devient un tiroir
  const [drawer, setDrawer] = useState(false)

  const loadPlaylists = useCallback(async (s: Service) => {
    setLoadingLists((l) => ({ ...l, [s]: true }))
    try {
      const list = await api.playlists(s)
      setPlaylists((p) => ({ ...p, [s]: list }))
      return list
    } catch (e) {
      fail(e)
      return []
    } finally {
      setLoadingLists((l) => ({ ...l, [s]: false }))
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    const acc = await api.accounts()
    setAccounts(acc)
    for (const a of acc) if (a.connected) void loadPlaylists(a.service)
    if (!acc.some((a) => a.configured)) setDialog('settings')
  }, [loadPlaylists])

  useEffect(() => {
    void refreshAccounts()
  }, [refreshAccounts])

  const connected = accounts.filter((a) => a.connected).map((a) => a.service)

  /* ------------------------ playlists comparées ------------------------ */
  const [left, setLeft] = useState<Loaded | null>(null)
  const [right, setRight] = useState<Target | null>(null)
  const [picker, setPicker] = useState<'source' | 'cible' | null>(null)

  const loadTracks = useCallback(async (pl: Playlist): Promise<Track[] | null> => {
    try {
      return await api.tracks(pl.service, pl.id, newJobId())
    } catch (e) {
      fail(e)
      return null
    }
  }, [])

  const pickLeft = useCallback(
    async (pl: Playlist) => {
      setLeft({ playlist: pl, tracks: null })
      const tracks = await loadTracks(pl)
      setLeft((cur) => (cur?.playlist.id === pl.id && cur.playlist.service === pl.service ? { playlist: pl, tracks: tracks ?? [] } : cur))
    },
    [loadTracks]
  )

  const pickRight = useCallback(
    async (r: PickResult) => {
      if (r.kind === 'new') {
        setRight({ kind: 'new', service: r.service, name: r.name })
        return
      }
      setRight({ kind: 'existing', playlist: r.playlist, tracks: null })
      const tracks = await loadTracks(r.playlist)
      setRight((cur) =>
        cur?.kind === 'existing' && cur.playlist.id === r.playlist.id && cur.playlist.service === r.playlist.service
          ? { kind: 'existing', playlist: r.playlist, tracks: tracks ?? [] }
          : cur
      )
    },
    [loadTracks]
  )

  const canSwap = left && right?.kind === 'existing' && left.playlist.editable
  const swap = () => {
    if (!canSwap || right?.kind !== 'existing') return
    setLeft({ playlist: right.playlist, tracks: right.tracks })
    setRight({ kind: 'existing', playlist: left.playlist, tracks: left.tracks })
  }

  /* ---------------------------- comparaison ---------------------------- */
  // Références stables : sinon la comparaison (et la sélection) se recalculerait à chaque rendu
  const rightTracks = useMemo(
    () => (right?.kind === 'existing' ? right.tracks : right ? NO_TRACKS : null),
    [right]
  )
  const rightService = right ? (right.kind === 'existing' ? right.playlist.service : right.service) : undefined
  const rightName = right ? (right.kind === 'existing' ? right.playlist.name : right.name) : ''

  const compare = useMemo(
    () => (left?.tracks ? comparePlaylists(left.tracks, rightTracks ?? NO_TRACKS) : null),
    [left?.tracks, rightTracks]
  )

  // Sync dans les deux sens : possible si la cible existe et que la source accepte des ajouts
  const [twoWayWanted, setTwoWayWanted] = useState(false)
  const canTwoWay = !!left?.playlist.editable && right?.kind === 'existing'
  const twoWay = twoWayWanted && canTwoWay

  const [resolutions, setResolutions] = useState(new Map<string, Resolution>())
  const [selection, setSelection] = useState(new Set<string>())
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const actionable = useCallback(
    (rows: CompareRow[], both: boolean) => rows.filter((r) => rowDirection(r, both)).map((r) => r.key),
    []
  )

  // Nouvelle comparaison → on repart de zéro, tout ce qui peut être ajouté est coché
  useEffect(() => {
    setResolutions(new Map())
    setSelection(new Set(compare ? actionable(compare.rows, twoWay) : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare])

  // Correspondances déjà mémorisées (recherches passées, choix manuels) :
  // appliquées tout de suite, sans appel réseau
  useEffect(() => {
    if (!compare || !left?.tracks || !rightService) return
    let cancelled = false
    const apply = async (dir: Direction) => {
      const service = dir === 'right' ? rightService : left.playlist.service
      const targetTracks = dir === 'right' ? (rightTracks ?? NO_TRACKS) : left.tracks!
      const rows = compare.rows.filter((r) => rowDirection(r, true) === dir)
      const sources = rows.map((r) => (dir === 'right' ? r.left! : r.right!))
      if (!sources.length) return []
      const found = await api.peekMatches(service, sources)
      return rows.flatMap((r, i): Resolution[] => {
        const match = found[i]
        if (!match) return []
        const there = targetTracks.some((t) => t.id === match.id || sameTrack(t, match) !== null)
        return [{ sourceKey: r.key, status: there ? 'already-there' : 'found', match, method: 'cache', confidence: 1 }]
      })
    }
    void Promise.all([apply('right'), right?.kind === 'existing' ? apply('left') : []]).then(([a, b]) => {
      if (cancelled || !(a.length + b.length)) return
      setResolutions((m) => {
        const n = new Map(m)
        for (const r of [...a, ...b]) if (!n.has(r.sourceKey)) n.set(r.sourceKey, r)
        return n
      })
      setSelection((s) => {
        const n = new Set(s)
        for (const r of [...a, ...b]) if (r.status === 'already-there') n.delete(r.sourceKey)
        return n
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare])

  // Activer / couper le retour vers la source coche / décoche les titres concernés
  useEffect(() => {
    if (!compare) return
    const extra = compare.rows.filter((r) => r.status === 'extra').map((r) => r.key)
    setSelection((s) => {
      const n = new Set(s)
      for (const k of extra) twoWay ? n.add(k) : n.delete(k)
      return n
    })
  }, [twoWay, compare])

  const toggle = useCallback((key: string) => {
    setSelection((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }, [])

  const rowByKey = useMemo(() => new Map(compare?.rows.map((r) => [r.key, r]) ?? []), [compare])
  const dirOf = (key: string): Direction | null => {
    const r = rowByKey.get(key)
    return r ? rowDirection(r, twoWay) : null
  }
  const sourceOf = (key: string): Track | undefined => {
    const r = rowByKey.get(key)
    return dirOf(key) === 'left' ? r?.right : r?.left
  }

  const pendingKeys = compare ? actionable(compare.rows, twoWay) : []
  const selectable = pendingKeys.filter((k) => !['not-found', 'already-there'].includes(resolutions.get(k)?.status ?? ''))
  const allSelected = selectable.length > 0 && selectable.every((k) => selection.has(k))
  const selected = [...selection].filter((k) => dirOf(k))
  const toResolve = selected.filter((k) => !resolutions.has(k))
  const toAdd = selected.filter((k) => resolutions.get(k)?.status === 'found')
  const notFound = pendingKeys.filter((k) => resolutions.get(k)?.status === 'not-found').length
  // Ce qui reste vraiment à faire (les « déjà présents sous une autre version » ne comptent pas)
  const remaining = pendingKeys.filter((k) => resolutions.get(k)?.status !== 'already-there')

  const rows = useMemo(
    () =>
      (compare?.rows ?? []).filter(
        (r) =>
          (filter === 'all' || r.status === filter) &&
          matchesQuery(query, r.left, r.right, resolutions.get(r.key)?.match)
      ),
    [compare, filter, query, resolutions]
  )

  /* ------------------------------ actions ------------------------------ */
  const [job, setJob] = useState<ProgressEvent | null>(null)
  const busy = !!job && job.phase !== 'done' && job.phase !== 'error'

  useEffect(
    () =>
      api.onProgress((e) => {
        setJob((cur) => (cur && cur.jobId === e.jobId ? e : cur))
      }),
    []
  )

  const serviceFor = (dir: Direction): Service | undefined => (dir === 'right' ? rightService : left?.playlist.service)
  const tracksFor = (dir: Direction): Track[] => (dir === 'right' ? (rightTracks ?? NO_TRACKS) : (left?.tracks ?? NO_TRACKS))

  async function resolveSelected() {
    if (!compare || !left) return
    const found: Resolution[] = []
    try {
      for (const dir of ['right', 'left'] as Direction[]) {
        const service = serviceFor(dir)
        const keys = toResolve.filter((k) => dirOf(k) === dir)
        if (!keys.length || !service) continue
        const jobId = newJobId()
        setJob({ jobId, phase: 'resolving', done: 0, total: keys.length })
        const res = await api.resolve(jobId, service, keys.map((k) => ({ key: k, track: sourceOf(k)! })), tracksFor(dir))
        found.push(...res)
      }
      setResolutions((m) => {
        const n = new Map(m)
        for (const r of found) n.set(r.sourceKey, r)
        return n
      })
      // Introuvables et déjà présents ne sont plus cochés
      setSelection((s) => {
        const n = new Set(s)
        for (const r of found) if (r.status !== 'found') n.delete(r.sourceKey)
        return n
      })
      const nf = found.filter((r) => r.status === 'not-found').length
      notify(
        `${found.length - nf} sur ${plural(found.length, 'titre')} trouvé${found.length - nf > 1 ? 's' : ''}`,
        nf ? `${plural(nf, 'introuvable')}. Utilise « Choisir » pour les retrouver à la main.` : undefined
      )
    } catch (e) {
      fail(e)
    } finally {
      setJob(null)
    }
  }

  async function addSelected() {
    if (!left || !right || !rightService) return
    let reloadLeft = false
    let newRight: Playlist | null = null
    try {
      for (const dir of ['right', 'left'] as Direction[]) {
        const keys = toAdd.filter((k) => dirOf(k) === dir)
        if (!keys.length) continue
        const service = serviceFor(dir)!
        const target: AddTarget =
          dir === 'left'
            ? { service, playlistId: left.playlist.id }
            : right.kind === 'existing'
              ? { service, playlistId: right.playlist.id }
              : { service, create: { name: right.name, description: `Depuis « ${left.playlist.name} »` } }
        const tracks = keys.map((k) => resolutions.get(k)!.match!)
        const jobId = newJobId()
        setJob({ jobId, phase: 'adding', done: 0, total: tracks.length })
        const res = await api.add(jobId, target, tracks)

        const from = dir === 'right' ? left.playlist : (right as { playlist: Playlist }).playlist
        const toName = dir === 'right' ? rightName : left.playlist.name
        // Historique : tout ce qui a été cherché dans ce sens, y compris les introuvables
        const dirKeys = pendingKeys.filter((k) => dirOf(k) === dir && resolutions.has(k))
        await api.recordHistory(
          historyEntry({
            mode: dir === 'left' ? 'two-way' : 'single',
            source: { service: from.service, name: from.name },
            target: { service, name: toName },
            added: res.added,
            resolutions: dirKeys.map((k) => resolutions.get(k)!),
            sources: new Map(dirKeys.map((k) => [k, sourceOf(k)!]))
          })
        )
        notify(`${plural(res.added, 'titre')} ajouté${res.added > 1 ? 's' : ''} à ${toName}`)

        if (dir === 'left') reloadLeft = true
        else {
          const lists = await loadPlaylists(service)
          newRight = lists.find((x) => x.id === res.playlistId) ?? { id: res.playlistId, service, name: toName, editable: true }
        }
      }
      // On recharge pour voir le résultat
      if (reloadLeft) void loadPlaylists(left.playlist.service)
      if (reloadLeft) await pickLeft(left.playlist)
      if (newRight) await pickRight({ kind: 'existing', playlist: newRight })
      else if (reloadLeft && right.kind === 'existing') await pickRight({ kind: 'existing', playlist: right.playlist })
    } catch (e) {
      fail(e)
    } finally {
      setJob(null)
    }
  }

  /* ------------------------ correction manuelle ------------------------ */
  const [fixKey, setFixKey] = useState<string | null>(null)
  const fixDir = fixKey ? dirOf(fixKey) : null
  const fixSource = fixKey ? (sourceOf(fixKey) ?? null) : null
  const fixTarget = fixDir ? serviceFor(fixDir) : undefined

  async function applyFix(match: Track) {
    if (!fixKey || !fixSource || !fixDir || !fixTarget) return
    const there = tracksFor(fixDir).some((t) => t.id === match.id || sameTrack(t, match))
    await api.saveMatch(fixSource, fixTarget, match).catch(fail)
    setResolutions((m) =>
      new Map(m).set(fixKey, { sourceKey: fixKey, status: there ? 'already-there' : 'found', match, method: 'manual', confidence: 1 })
    )
    setSelection((s) => {
      const n = new Set(s)
      if (there) n.delete(fixKey)
      else n.add(fixKey)
      return n
    })
    if (there) notify('Déjà présent', `${match.title} est déjà dans la playlist, il ne sera pas ajouté.`)
    setFixKey(null)
  }

  /* ------------------------------- rendu ------------------------------- */
  const filters: { value: Filter; label: string; count?: number }[] = [
    { value: 'all', label: 'Tout', count: compare?.rows.length },
    { value: 'missing', label: 'Manquants', count: compare?.stats.missing },
    { value: 'both', label: 'En commun', count: compare?.stats.both },
    { value: 'extra', label: 'Seulement dans la cible', count: compare?.stats.extra },
    { value: 'duplicate', label: 'Doublons', count: compare?.stats.duplicate }
  ]
  const exportName = `${left?.playlist.name ?? 'playlist'}${right ? ` vs ${rightName}` : ''}.csv`

  return (
    <div className="flex h-full">
      {drawer && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setDrawer(false)} />}
      <Sidebar
        className={cn('max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl', !drawer && 'max-md:hidden')}
        accounts={accounts}
        playlists={playlists}
        loading={loadingLists}
        tab={tab}
        onTab={setTab}
        selectedId={left?.playlist.service === tab ? left.playlist.id : undefined}
        onPick={(pl) => {
          setDrawer(false)
          void pickLeft(pl)
        }}
        onConnect={async (s) => {
          try {
            await api.connect(s)
            await refreshAccounts()
            notify(`${SERVICE_LABEL[s]} connecté`)
          } catch (e) {
            fail(e)
          }
        }}
        onDisconnect={async (s) => {
          await api.disconnect(s)
          setPlaylists((p) => ({ ...p, [s]: [] }))
          await refreshAccounts()
        }}
        onRefresh={(s) => void loadPlaylists(s)}
        onSettings={() => (setDrawer(false), setDialog('settings'))}
        onBatch={() => (setDrawer(false), setDialog('batch'))}
        onHistory={() => (setDrawer(false), setDialog('history'))}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* En-tête : source ⇄ cible */}
        <header className="drag border-b px-4 pt-3 pb-3 md:pt-7">
          <div className="mb-2 flex items-center gap-2 md:hidden">
            <Button variant="ghost" size="icon-sm" aria-label="Comptes et playlists" onClick={() => setDrawer(true)}>
              <Icon name="menu" />
            </Button>
            <span className="text-sm font-semibold">Playlist Bridge</span>
            <span className="flex-1" />
            {isDemo && <Badge variant="outline">Mode démo</Badge>}
          </div>
          <div className="grid grid-cols-1 items-center gap-1 md:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] md:gap-0">
            {left ? (
              <PlaylistSlot side="source" playlist={left.playlist} count={left.tracks?.length} onClick={() => setPicker('source')} />
            ) : (
              <PlaylistSlot side="source" onClick={() => setPicker('source')} />
            )}
            <div className="grid place-items-center">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Inverser source et cible"
                disabled={!canSwap || busy}
                onClick={swap}
                className="text-muted-foreground max-md:rotate-90"
              >
                <Icon name="swap" />
              </Button>
            </div>
            {right?.kind === 'existing' ? (
              <PlaylistSlot side="cible" playlist={right.playlist} count={right.tracks?.length} onClick={() => setPicker('cible')} />
            ) : right?.kind === 'new' ? (
              <PlaylistSlot side="cible" draft={right} onClick={() => setPicker('cible')} />
            ) : (
              <PlaylistSlot side="cible" onClick={() => setPicker('cible')} />
            )}
          </div>

          {compare && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 md:mx-0 md:max-w-none md:px-0">
                <ToggleGroup className="w-max" value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as Filter)}>
                  {filters
                    .filter((f) => f.value === 'all' || f.count)
                    .map((f) => (
                      <Toggle key={f.value} value={f.value} className="gap-1.5">
                        {f.label}
                        <span className="tnum text-muted-foreground">{f.count ?? 0}</span>
                      </Toggle>
                    ))}
                </ToggleGroup>
              </div>
              <span className="flex-1 max-md:hidden" />
              <div className="relative min-w-40 flex-1 md:max-w-56 md:flex-none">
                <Icon name="search" size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="row-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrer les titres"
                  aria-label="Filtrer les titres"
                  className="pl-8"
                />
              </div>
              {canTwoWay && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toggle
                        pressed={twoWayWanted}
                        onPressedChange={setTwoWayWanted}
                        className="gap-1.5 data-pressed:text-new"
                        aria-label="Synchroniser dans les deux sens"
                      />
                    }
                  >
                    <Icon name="sync" size={14} /> Dans les deux sens
                  </TooltipTrigger>
                  <TooltipContent>Ajoute aussi à « {left?.playlist.name} » les titres qui ne sont que dans la cible</TooltipContent>
                </Tooltip>
              )}
              {right && selectable.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelection(allSelected ? new Set() : new Set(selectable))}>
                  {allSelected ? 'Tout décocher' : 'Tout cocher'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Exporter en CSV"
                title="Exporter en CSV"
                onClick={() => left && saveCsv(exportName, compareToCsv(rows, resolutions, left.playlist.service, rightService))}
              >
                <Icon name="download" />
              </Button>
            </div>
          )}
        </header>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto pt-2">
          {!left ? (
            <Empty className="mx-auto mt-24 px-4">
              <EmptyHeader>
                <EmptyMedia>
                  <Icon name="play" size={18} />
                </EmptyMedia>
                <EmptyTitle>Choisis une playlist source</EmptyTitle>
                <EmptyDescription>
                  Ouvre une playlist (ou tes titres likés), puis choisis où ajouter ses titres. Pour tout envoyer d’un coup, passe par le transfert groupé.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => setPicker('source')}>
                  Choisir une playlist
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDialog('batch')}>
                  <Icon name="batch" /> Transfert groupé
                </Button>
              </EmptyContent>
            </Empty>
          ) : !left.tracks || (right?.kind === 'existing' && !right.tracks) ? (
            <div className="space-y-2 px-6 pt-2">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-center md:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-2.5 w-1/4" />
                    </div>
                  </div>
                  <span />
                  {right && (
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-md" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="px-6 py-16 text-center text-xs text-muted-foreground">
              {query ? `Aucun titre ne correspond à « ${query} ».` : 'Rien dans cette catégorie.'}
            </p>
          ) : (
            <CompareRows
              rows={rows}
              resolutions={resolutions}
              selection={selection}
              twoWay={twoWay}
              leftService={left.playlist.service}
              rightService={rightService}
              rightIsNew={right?.kind === 'new'}
              onToggle={toggle}
              onFix={setFixKey}
              onOpen={(url) => void api.openExternal(url)}
            />
          )}
        </div>

        {/* Barre d'action */}
        {compare && right && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-4">
            <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-popover p-2 pl-4 shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
              {busy && job ? (
                <div className="flex flex-1 items-center gap-3">
                  <Spinner />
                  <Progress value={job.total ? (job.done / job.total) * 100 : null} className="flex-1" />
                  <span className="tnum text-xs text-muted-foreground">
                    {job.phase === 'resolving' ? 'Recherche' : 'Ajout'} {job.done}/{job.total}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {remaining.length === 0 ? (
                      <span>{twoWay ? 'Les deux playlists sont synchronisées.' : 'Tout est déjà dans la cible.'}</span>
                    ) : (
                      <>
                        <span>
                          <span className="tnum text-foreground">{selected.length}</span> sélectionné{selected.length > 1 ? 's' : ''}
                        </span>
                        {twoWay && (
                          <Badge variant="outline" className="tnum">
                            {selected.filter((k) => dirOf(k) === 'left').length} vers la source
                          </Badge>
                        )}
                        {toResolve.length > 0 && toAdd.length > 0 && <Badge variant="outline">{toResolve.length} à chercher</Badge>}
                        {notFound > 0 && <Badge variant="destructive">{plural(notFound, 'introuvable')}</Badge>}
                      </>
                    )}
                  </div>
                  {remaining.length === 0 ? null : toResolve.length > 0 ? (
                    <Button onClick={resolveSelected} disabled={busy}>
                      <Icon name="search" /> Trouver {plural(toResolve.length, 'titre')}
                    </Button>
                  ) : (
                    <Button onClick={addSelected} disabled={busy || toAdd.length === 0} className="bg-new text-black hover:bg-new/85">
                      <Icon name="plus" /> Ajouter {plural(toAdd.length, 'titre')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {isDemo && (
          <Badge variant="outline" className="absolute top-3 right-4 max-md:hidden">
            Mode démo
          </Badge>
        )}
      </main>

      <PlaylistPicker
        open={picker !== null}
        title={picker === 'source' ? 'Choisir la playlist source' : 'Où ajouter les titres ?'}
        playlists={playlists}
        connected={connected.length ? connected : SERVICES}
        asTarget={picker === 'cible'}
        suggestedName={left?.playlist.kind === 'liked' ? `${left.playlist.name} (${SERVICE_LABEL[left.playlist.service]})` : left?.playlist.name}
        onClose={() => setPicker(null)}
        onPick={(r) => {
          if (picker === 'source' && r.kind === 'existing') void pickLeft(r.playlist)
          else if (picker === 'cible') void pickRight(r)
          setPicker(null)
        }}
      />
      <MatchDialog
        source={fixSource}
        target={fixTarget ?? 'spotify'}
        current={fixKey ? resolutions.get(fixKey)?.match : undefined}
        onPick={(t) => void applyFix(t)}
        onSkip={() => {
          if (fixKey) setSelection((s) => (s.delete(fixKey), new Set(s)))
          setFixKey(null)
        }}
        onClose={() => setFixKey(null)}
      />
      <BatchDialog
        open={dialog === 'batch'}
        playlists={playlists}
        connected={connected}
        onClose={() => setDialog(null)}
        onFinished={(s) => void loadPlaylists(s)}
      />
      <HistoryDialog open={dialog === 'history'} onClose={() => setDialog(null)} />
      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} onSaved={refreshAccounts} />
    </div>
  )
}
