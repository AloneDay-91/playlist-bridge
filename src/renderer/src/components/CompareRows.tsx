import { memo, type ReactNode } from 'react'
import { trackUrl } from '@shared/csv'
import { formatDuration } from '@shared/matching'
import { SERVICE_LABEL, type CompareRow, type Resolution, type Service, type Track } from '@shared/types'
import { Checkbox } from '@/components/ui/Checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { Cover } from './Cover'
import { Icon } from './Icon'

export const METHOD_LABEL: Record<string, string> = {
  isrc: 'Même ISRC des deux côtés',
  metadata: 'Même titre, artiste et durée',
  'search-isrc': 'Trouvé par ISRC',
  'search-text': 'Trouvé par recherche titre + artiste, à vérifier',
  manual: 'Choisi à la main',
  cache: 'Correspondance mémorisée'
}

/** Sens d'ajout d'une ligne : vers la cible (droite) ou vers la source (gauche) */
export type Direction = 'right' | 'left'

export function rowDirection(row: CompareRow, twoWay: boolean): Direction | null {
  if (row.status === 'missing') return 'right'
  if (row.status === 'extra' && twoWay) return 'left'
  return null
}

const linkBtn =
  'inline-flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/30'

function TrackCell({
  track,
  tone = 'plain',
  hint,
  action,
  onOpen
}: {
  track: Track
  tone?: 'plain' | 'pending' | 'dim'
  hint?: string
  action?: ReactNode
  onOpen: (url: string) => void
}) {
  return (
    <div
      className={cn(
        'group/cell flex h-full min-w-0 items-center gap-2 rounded-xl border px-1.5 sm:gap-3 sm:px-2.5',
        tone === 'pending' ? 'border-dashed border-new/70 bg-new/8' : 'border-transparent',
        tone === 'dim' && 'opacity-45'
      )}
      title={[track.title, track.artists.join(', '), track.album, hint].filter(Boolean).join('\n')}
    >
      <Cover src={track.cover} size={36} className="rounded-md max-sm:hidden" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm">
          {track.title}
          {track.version && <span className="text-muted-foreground"> ({track.version})</span>}
          {track.explicit && (
            <span className="ml-1.5 inline-grid size-4 place-items-center rounded bg-muted align-middle text-[10px] text-muted-foreground" aria-label="Explicite">
              E
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{track.artists.join(', ')}</div>
      </div>
      {action}
      <button
        onClick={() => onOpen(trackUrl(track))}
        aria-label={`Ouvrir dans ${SERVICE_LABEL[track.service]}`}
        title={`Ouvrir dans ${SERVICE_LABEL[track.service]}`}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/cell:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/30 max-sm:hidden"
      >
        <Icon name="external" size={13} />
      </button>
      <span className="tnum text-xs text-muted-foreground max-sm:hidden">{formatDuration(track.durationMs)}</span>
    </div>
  )
}

const searchUrl = (service: Service, t: Track): string => {
  const q = encodeURIComponent(`${t.title} ${t.artists[0] ?? ''}`)
  return service === 'spotify' ? `https://open.spotify.com/search/${q}` : `https://tidal.com/search?q=${q}`
}

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="relative grid size-8 place-items-center rounded-full bg-background" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface RowProps {
  row: CompareRow
  resolution?: Resolution
  selected: boolean
  twoWay: boolean
  leftService: Service
  rightService?: Service
  rightIsNew: boolean
  onToggle: (key: string) => void
  onFix: (key: string) => void
  onOpen: (url: string) => void
}

/**
 * Une ligne = un titre aligné de part et d'autre du « pont ».
 * La colonne centrale dit ce qui se passe entre les deux côtés.
 * Un titre à ajouter apparaît en pointillés du côté où il va arriver.
 */
const Row = memo(function Row(p: RowProps) {
  const { row, resolution: res, selected } = p
  const { status, left, right } = row
  const dir = rowDirection(row, p.twoWay)
  const source = dir === 'right' ? left : dir === 'left' ? right : undefined
  const targetService = dir === 'right' ? p.rightService : dir === 'left' ? p.leftService : undefined
  const targetName = targetService ? SERVICE_LABEL[targetService] : 'la cible'

  /* ------------------------- colonne centrale ------------------------- */
  let spine: ReactNode
  if (status === 'both') {
    spine = (
      <Hint label={METHOD_LABEL[row.method ?? 'isrc']}>
        <Icon name="linked" size={15} className="text-both" />
      </Hint>
    )
  } else if (status === 'duplicate') {
    spine = (
      <Hint label="Doublon dans la source, ignoré">
        <Icon name="duplicate" size={15} className="text-destructive" />
      </Hint>
    )
  } else if (!dir) {
    spine = (
      <Hint label="Seulement dans la cible. Active « Dans les deux sens » pour l’ajouter aussi à la source.">
        <span className="size-1.5 rounded-full bg-extra" />
      </Hint>
    )
  } else if (res?.status === 'not-found') {
    spine = (
      <Hint label={res.error ?? `Introuvable sur ${targetName}`}>
        <Icon name="notFound" size={15} className="text-destructive" />
      </Hint>
    )
  } else if (res?.status === 'already-there') {
    spine = (
      <Hint label={`Déjà sur ${targetName} sous une autre version`}>
        <Icon name="check" size={15} className="text-both" />
      </Hint>
    )
  } else {
    spine = (
      <span className="relative grid size-8 place-items-center rounded-full bg-background">
        <Checkbox
          checked={selected}
          onCheckedChange={() => p.onToggle(row.key)}
          aria-label={`Ajouter ${source?.title ?? ''} ${dir === 'left' ? 'à la source' : 'à la cible'}`}
          className="size-5 rounded-md border-new/60 data-checked:border-new data-checked:bg-new data-checked:text-black"
        />
      </span>
    )
  }

  /* ----------------- côté où le titre va être ajouté ----------------- */
  let pending: ReactNode = null
  if (dir && source && targetService) {
    const choose = (always: boolean) => (
      <button
        onClick={() => p.onFix(row.key)}
        aria-label={res?.match ? 'Changer le titre choisi' : 'Choisir le titre à la main'}
        className={cn(linkBtn, 'shrink-0', !always && 'sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100')}
      >
        <Icon name="edit" size={12} />
        {/* Sur téléphone : icône seule, pour laisser la place au titre */}
        <span className={cn(!always && 'max-sm:sr-only')}>{res?.match ? 'Changer' : 'Choisir'}</span>
      </button>
    )
    if (res?.match && (res.status === 'found' || res.status === 'already-there')) {
      pending = (
        <TrackCell
          track={res.match}
          tone={res.status === 'found' && selected ? 'pending' : 'dim'}
          hint={METHOD_LABEL[res.method ?? 'search-isrc']}
          action={res.status === 'found' ? choose(false) : undefined}
          onOpen={p.onOpen}
        />
      )
    } else if (res?.status === 'not-found') {
      pending = (
        <div className="flex h-full flex-wrap content-center items-center gap-x-1 px-1.5 text-xs text-destructive sm:px-3">
          <span className="mr-1">Introuvable sur {targetName}</span>
          {choose(true)}
          <button onClick={() => p.onOpen(searchUrl(targetService, source))} className={cn(linkBtn, 'max-sm:hidden')}>
            Ouvrir la recherche <Icon name="external" size={11} />
          </button>
        </div>
      )
    } else {
      pending = (
        <div className={cn('flex h-full items-center gap-2 px-1.5 text-xs sm:px-3', selected ? 'text-new' : 'text-muted-foreground')}>
          {dir === 'left' && <Icon name="arrowLeft" size={12} />}
          {selected ? (dir === 'right' && p.rightIsNew ? 'Sera ajouté' : `À ajouter sur ${targetName}`) : 'Absent'}
          {choose(false)}
        </div>
      )
    }
  }

  const bridge =
    status === 'both' || res?.status === 'already-there'
      ? 'bg-both/50'
      : dir && selected && res?.status !== 'not-found'
        ? 'bg-new/70'
        : 'bg-border'

  return (
    <div
      className="group/row grid h-14 grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-stretch rounded-2xl py-1 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 56px' }}
    >
      <div className={cn(status === 'duplicate' && 'line-through decoration-destructive/60 opacity-45')}>
        {left ? <TrackCell track={left} onOpen={p.onOpen} /> : dir === 'left' ? pending : null}
      </div>
      <div className="relative grid place-items-center">
        {/* le tablier du pont */}
        <span aria-hidden className={cn('absolute inset-x-0 top-1/2 h-px', bridge)} />
        {spine}
      </div>
      <div>{right ? <TrackCell track={right} onOpen={p.onOpen} /> : dir === 'right' ? pending : null}</div>
    </div>
  )
})

export function CompareRows({
  rows,
  resolutions,
  selection,
  ...rest
}: Omit<RowProps, 'row' | 'resolution' | 'selected'> & {
  rows: CompareRow[]
  resolutions: Map<string, Resolution>
  selection: Set<string>
}) {
  return (
    <div className="px-4 pb-36 md:pb-28">
      {rows.map((r) => (
        <Row key={r.key} row={r} resolution={resolutions.get(r.key)} selected={selection.has(r.key)} {...rest} />
      ))}
    </div>
  )
}
