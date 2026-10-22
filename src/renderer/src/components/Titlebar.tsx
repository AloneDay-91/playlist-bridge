import { isDemo } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from './Icon'

/**
 * macOS dessine les boutons de fenêtre par-dessus le webview.
 * `data-tauri-drag-region="deep"` rend toute la bande déplaçable, y compris le titre.
 * Les boutons Lumen restent cliquables : Tauri ignore les éléments interactifs.
 */
const nativeMac = !isDemo && /\bMac/.test(navigator.userAgent)

export function Titlebar({ onMenu }: { onMenu: () => void }) {
  return (
    <header
      data-tauri-drag-region="deep"
      className="drag flex h-12 shrink-0 items-center gap-2 border-b bg-background pr-3 select-none"
    >
      <div className={cn('flex min-w-0 items-center gap-2', nativeMac ? 'pl-24' : 'pl-3')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Comptes et playlists"
          className="no-drag md:hidden"
          data-tauri-drag-region="false"
          onClick={onMenu}
        >
          <Icon name="menu" />
        </Button>
        <h1 className="truncate text-sm font-semibold">Playlist Bridge</h1>
      </div>
      <span className="min-w-8 flex-1 self-stretch" data-tauri-drag-region="deep" />
      {isDemo && (
        <Badge variant="outline" className="no-drag">
          Mode démo
        </Badge>
      )}
    </header>
  )
}
