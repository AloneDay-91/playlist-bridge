import { cn } from '@/lib/utils'
import { Icon, type IconName } from './Icon'

export function Cover({
  src,
  size = 40,
  className,
  icon
}: {
  src?: string
  size?: number
  className?: string
  /** Icône à la place de la pochette (ex. cœur pour les titres likés) */
  icon?: IconName
}) {
  const box = cn('shrink-0 rounded-lg bg-muted', className)
  if (icon) {
    return (
      <div className={cn(box, 'grid place-items-center bg-new/15 text-new')} style={{ width: size, height: size }}>
        <Icon name={icon} size={Math.round(size * 0.45)} />
      </div>
    )
  }
  return src ? (
    <img src={src} alt="" width={size} height={size} loading="lazy" className={cn(box, 'object-cover')} style={{ width: size, height: size }} />
  ) : (
    <div className={cn(box, 'grid place-items-center text-muted-foreground')} style={{ width: size, height: size }}>
      <Icon name="sound" size={Math.round(size * 0.42)} />
    </div>
  )
}

/** Pochette d'une playlist, avec le cœur pour les titres likés */
export function PlaylistCover({
  playlist,
  size,
  className
}: {
  playlist: { cover?: string; kind?: 'liked' }
  size?: number
  className?: string
}) {
  return <Cover src={playlist.cover} size={size} className={className} icon={playlist.kind === 'liked' ? 'heart' : undefined} />
}
