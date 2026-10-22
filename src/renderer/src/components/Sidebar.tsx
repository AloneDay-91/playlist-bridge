import { SERVICE_LABEL, type AccountStatus, type Playlist, type Service } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/Tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { Empty, EmptyDescription, EmptyMedia } from '@/components/ui/Empty'
import { cn } from '@/lib/utils'
import { PlaylistCover } from './Cover'
import { Icon, ServiceLogo } from './Icon'

const SERVICES: Service[] = ['spotify', 'tidal']

interface Props {
  accounts: AccountStatus[]
  playlists: Record<Service, Playlist[]>
  loading: Record<Service, boolean>
  tab: Service
  onTab: (s: Service) => void
  selectedId?: string
  onPick: (p: Playlist) => void
  onConnect: (s: Service) => void
  onDisconnect: (s: Service) => void
  onRefresh: (s: Service) => void
  onSettings: () => void
  onBatch: () => void
  onHistory: () => void
  className?: string
}

export function Sidebar(p: Props) {
  const account = (s: Service) => p.accounts.find((a) => a.service === s)
  const current = account(p.tab)

  return (
    <aside className={cn('flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground', p.className)}>
      <div className="drag flex h-14 items-end px-5 pb-2 pt-6">
        <h1 className="text-sm font-semibold">Playlist Bridge</h1>
      </div>

      {/* Comptes */}
      <section aria-label="Comptes" className="space-y-0.5 border-b px-3 pt-2 pb-3">
        {SERVICES.map((s) => {
          const a = account(s)
          return (
            <div key={s} className="group flex h-11 items-center gap-3 rounded-xl px-2">
              <ServiceLogo service={s} size={18} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-sm">{SERVICE_LABEL[s]}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {a?.connected ? (a.displayName ?? 'Connecté') : a?.configured ? 'Pas connecté' : 'Client ID manquant'}
                </div>
              </div>
              {a?.connected ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Déconnecter ${SERVICE_LABEL[s]}`}
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => p.onDisconnect(s)}
                      />
                    }
                  >
                    <Icon name="logout" />
                  </TooltipTrigger>
                  <TooltipContent>Déconnecter</TooltipContent>
                </Tooltip>
              ) : a?.configured ? (
                <Button size="sm" variant="outline" onClick={() => p.onConnect(s)}>
                  Connecter
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={p.onSettings}>
                  Configurer
                </Button>
              )}
            </div>
          )
        })}
      </section>

      {/* Playlists */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <Tabs value={p.tab} onValueChange={(v) => p.onTab(v as Service)}>
          <TabsList>
            {SERVICES.map((s) => (
              <TabsTab key={s} value={s} className="gap-1.5">
                <ServiceLogo service={s} size={12} />
                {SERVICE_LABEL[s]}
              </TabsTab>
            ))}
            <TabsIndicator />
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        {current?.connected && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Recharger les playlists"
            className="text-muted-foreground"
            onClick={() => p.onRefresh(p.tab)}
          >
            <Icon name="refresh" className={cn(p.loading[p.tab] && 'animate-spin')} />
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label={`Playlists ${SERVICE_LABEL[p.tab]}`}>
        {!current?.connected ? (
          <Empty className="py-10">
            <EmptyMedia>
              <ServiceLogo service={p.tab} size={20} />
            </EmptyMedia>
            <EmptyDescription>Connecte ton compte {SERVICE_LABEL[p.tab]} pour voir tes playlists.</EmptyDescription>
          </Empty>
        ) : p.loading[p.tab] && !p.playlists[p.tab].length ? (
          <div className="space-y-1.5 px-1 pt-1">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-1">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : p.playlists[p.tab].length === 0 ? (
          <p className="px-3 py-8 text-xs text-muted-foreground">Aucune playlist sur ce compte.</p>
        ) : (
          p.playlists[p.tab].map((pl) => (
            <button
              key={pl.id}
              onClick={() => p.onPick(pl)}
              aria-current={p.selectedId === pl.id ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30',
                p.selectedId === pl.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
              )}
            >
              <PlaylistCover playlist={pl} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{pl.name}</span>
                <span className="tnum block text-xs text-muted-foreground">
                  {pl.trackCount ?? '?'} titres{pl.editable ? '' : ', lecture seule'}
                </span>
              </span>
            </button>
          ))
        )}
      </nav>

      <div className="flex flex-col items-start gap-0.5 border-t px-3 py-3">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={p.onBatch}>
          <Icon name="batch" /> Transfert groupé
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={p.onHistory}>
          <Icon name="history" /> Historique
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={p.onSettings}>
          <Icon name="settings" /> Réglages
        </Button>
      </div>
    </aside>
  )
}
