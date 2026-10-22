import { RuneIcon } from 'runeicons-react'
import { BrandLogo, getBrand } from 'runeicons-react/brands'
import { cn } from '@/lib/utils'
import type { Service } from '@shared/types'

/**
 * Icônes RuneIcons (runeicons.com).
 * RuneIcon ne transmet pas className : on l'enveloppe pour pouvoir le styler
 * (couleur via currentColor, rotation, etc.).
 */
export const ICONS = {
  arrowRight: 'arrows-arrow-right',
  swap: 'arrows-arrow-left-right',
  check: 'indicators-check',
  close: 'indicators-x',
  notFound: 'indicators-circle-x',
  alert: 'indicators-circle-alert',
  info: 'indicators-info',
  plus: 'indicators-plus',
  external: 'indicators-square-arrow-out-up-right',
  linked: 'code-link',
  duplicate: 'layouts-layers-2',
  copy: 'code-copy',
  search: 'tools-search',
  settings: 'tools-settings',
  refresh: 'schedule-refresh-cw',
  spinner: 'arrows-rotate-cw',
  logout: 'identity-log-out',
  user: 'indicators-circle-user',
  sound: 'playback-volume-2',
  play: 'playback-play',
  filter: 'tools-list-filter',
  menu: 'layouts-menu',
  arrowLeft: 'arrows-arrow-left',
  heart: 'tools-heart',
  history: 'schedule-history',
  sync: 'schedule-repeat',
  batch: 'layouts-layers-2',
  download: 'documents-file-down',
  edit: 'tools-pencil',
  trash: 'tools-trash-2'
} as const

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 16,
  className,
  label
}: {
  name: IconName
  size?: number
  className?: string
  /** Si fourni, l'icône est annoncée aux lecteurs d'écran */
  label?: string
}) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <RuneIcon name={ICONS[name]} size={size} />
    </span>
  )
}

/**
 * Recadrage sur le symbole seul : le logo Spotify de RuneIcons est horizontal
 * (symbole + texte), on ne garde que le cercle pour un rendu carré.
 */
const BRAND_VIEWBOX: Partial<Record<Service, string>> = { spotify: '0 0 88 88' }

/** Logo de la plateforme (RuneIcons brands), inversé en mode sombre car dessiné en noir */
export function ServiceLogo({ service, size = 16, className }: { service: Service; size?: number; className?: string }) {
  const brand = getBrand(service)
  const label = service === 'spotify' ? 'Spotify' : 'TIDAL'
  return (
    <span className={cn('inline-flex shrink-0 dark:invert', className)} style={{ width: size, height: size }}>
      {brand ? (
        <svg
          viewBox={BRAND_VIEWBOX[service] ?? brand.viewBox}
          width={size}
          height={size}
          role="img"
          aria-label={label}
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: brand.markup }}
        />
      ) : (
        <BrandLogo name={service} size={size} title={label} />
      )}
    </span>
  )
}
