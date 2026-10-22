import { SERVICE_LABEL, type Playlist, type Service } from '@shared/types'
import { cn } from '@/lib/utils'
import { PlaylistCover } from './Cover'
import { Icon, ServiceLogo } from './Icon'

type Props =
  | { side: 'source' | 'cible'; playlist: Playlist; count?: number; onClick: () => void }
  | { side: 'source' | 'cible'; draft: { service: Service; name: string }; onClick: () => void }
  | { side: 'source' | 'cible'; onClick: () => void }

/** Carte cliquable en tête de colonne : la playlist source ou cible */
export function PlaylistSlot(p: Props) {
  const filled = 'playlist' in p || 'draft' in p
  return (
    <button
      onClick={p.onClick}
      className={cn(
        'group flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 pr-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30',
        filled ? 'hover:bg-muted' : 'border border-dashed hover:bg-muted/60'
      )}
    >
      {'playlist' in p ? (
        <PlaylistCover playlist={p.playlist} size={44} className="rounded-xl" />
      ) : (
        <span className={cn('grid size-11 place-items-center rounded-xl', 'draft' in p ? 'border border-dashed border-new/70 text-new' : 'bg-muted text-muted-foreground')}>
          <Icon name={'draft' in p ? 'plus' : 'search'} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{p.side === 'source' ? 'Source' : 'Cible'}</span>
        {'playlist' in p ? (
          <>
            <span className="block truncate text-base font-medium">{p.playlist.name}</span>
            <span className="tnum flex items-center gap-1.5 text-xs text-muted-foreground">
              <ServiceLogo service={p.playlist.service} size={12} />
              {SERVICE_LABEL[p.playlist.service]}, {p.count ?? p.playlist.trackCount ?? '?'} titres
            </span>
          </>
        ) : 'draft' in p ? (
          <>
            <span className="block truncate text-base font-medium">{p.draft.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ServiceLogo service={p.draft.service} size={12} />
              Nouvelle playlist sur {SERVICE_LABEL[p.draft.service]}
            </span>
          </>
        ) : (
          <span className="block text-base font-medium text-muted-foreground">
            {p.side === 'source' ? 'Choisir la playlist source' : 'Choisir où ajouter'}
          </span>
        )}
      </span>
      {filled && <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">Changer</span>}
    </button>
  )
}
