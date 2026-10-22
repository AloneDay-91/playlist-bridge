import { SERVICE_LABEL, type Playlist, type Service } from '@shared/types'
import { Button } from '@/components/ui/Button'
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
    <Button
      variant={filled ? 'secondary' : 'outline'}
      onClick={p.onClick}
      className="h-auto w-full min-w-0 justify-start gap-3 rounded-2xl px-2.5 py-2 text-left whitespace-normal"
    >
      {'playlist' in p ? (
        <PlaylistCover playlist={p.playlist} size={44} className="rounded-xl" />
      ) : (
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-xl',
            'draft' in p ? 'border border-dashed border-new/70 text-new' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon name={'draft' in p ? 'plus' : 'search'} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-normal text-muted-foreground">{p.side === 'source' ? 'Source' : 'Cible'}</span>
        {'playlist' in p ? (
          <>
            <span className="block truncate text-base font-medium">{p.playlist.name}</span>
            <span className="tnum flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <ServiceLogo service={p.playlist.service} size={12} />
              {SERVICE_LABEL[p.playlist.service]}, {p.count ?? p.playlist.trackCount ?? '?'} titres
            </span>
          </>
        ) : 'draft' in p ? (
          <>
            <span className="block truncate text-base font-medium">{p.draft.name}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
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
      {filled && (
        <span className="text-xs font-normal text-muted-foreground opacity-0 transition-opacity group-hover/button:opacity-100">
          Changer
        </span>
      )}
    </Button>
  )
}
