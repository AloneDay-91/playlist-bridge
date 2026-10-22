import { useMemo, useState } from 'react'
import { SERVICE_LABEL, type Playlist, type Service } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { PlaylistCover } from './Cover'
import { Icon, ServiceLogo } from './Icon'

export type PickResult = { kind: 'existing'; playlist: Playlist } | { kind: 'new'; service: Service; name: string }

interface Props {
  open: boolean
  title: string
  playlists: Record<Service, Playlist[]>
  connected: Service[]
  /** Cible : seulement les playlists modifiables + « nouvelle playlist » */
  asTarget?: boolean
  suggestedName?: string
  onPick: (r: PickResult) => void
  onClose: () => void
}

export function PlaylistPicker(p: Props) {
  const [q, setQ] = useState('')
  const [newFor, setNewFor] = useState<Service | null>(null)
  const [newName, setNewName] = useState('')

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return p.connected.map((s) => ({
      service: s,
      items: p.playlists[s].filter(
        (pl) => (!p.asTarget || pl.editable) && (!needle || pl.name.toLowerCase().includes(needle))
      )
    }))
  }, [q, p.playlists, p.connected, p.asTarget])

  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => {
        if (!o) p.onClose()
        setQ('')
        setNewFor(null)
      }}
    >
      <DialogContent className="max-h-[72vh] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 sm:max-w-lg">
        <DialogTitle>{p.title}</DialogTitle>
        <div className="relative">
          <Icon name="search" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une playlist" className="pl-8" />
        </div>

        <div className="-mx-2 overflow-y-auto px-2">
          {p.asTarget &&
            p.connected.map((s) =>
              newFor === s ? (
                <form
                  key={s}
                  className="flex items-center gap-2 px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (newName.trim()) p.onPick({ kind: 'new', service: s, name: newName.trim() })
                  }}
                >
                  <ServiceLogo service={s} />
                  <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la playlist" />
                  <Button type="submit" size="sm" disabled={!newName.trim()}>
                    Choisir
                  </Button>
                </form>
              ) : (
                <button
                  key={s}
                  onClick={() => {
                    setNewFor(s)
                    setNewName(p.suggestedName ?? '')
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <span className="grid size-9 place-items-center rounded-lg border border-dashed text-new">
                    <Icon name="plus" />
                  </span>
                  Nouvelle playlist sur {SERVICE_LABEL[s]}
                </button>
              )
            )}

          {groups.map((g) => (
            <section key={g.service} className="mt-2">
              <h3 className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <ServiceLogo service={g.service} size={12} />
                {SERVICE_LABEL[g.service]}
              </h3>
              {g.items.length === 0 && <p className="px-2 pb-2 text-xs text-muted-foreground">Aucune playlist.</p>}
              {g.items.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => p.onPick({ kind: 'existing', playlist: pl })}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <PlaylistCover playlist={pl} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm">{pl.name}</span>
                  <span className="tnum text-xs text-muted-foreground">{pl.trackCount ?? ''}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
