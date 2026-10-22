import { useEffect, useState } from 'react'
import { notFoundToCsv } from '@shared/csv'
import type { HistoryEntry } from '@shared/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Empty, EmptyDescription, EmptyMedia } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { saveCsv } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { Icon, ServiceLogo } from './Icon'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

const MODE_LABEL: Record<HistoryEntry['mode'], string> = {
  single: 'Transfert',
  batch: 'Transfert groupé',
  'two-way': 'Sync, retour vers la source'
}

export function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (!open) return
    setConfirmClear(false)
    void api.history().then(setEntries)
  }, [open])

  const withMissing = entries?.filter((e) => e.notFound.length) ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[84vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Historique</DialogTitle>
          <DialogDescription>Chaque ajout de titres, avec ce qui n’a pas été trouvé.</DialogDescription>
        </DialogHeader>

        <div className="-mx-2 overflow-y-auto px-2">
          {entries?.length === 0 && (
            <Empty className="py-10">
              <EmptyMedia>
                <Icon name="history" size={18} />
              </EmptyMedia>
              <EmptyDescription>Aucun transfert pour l’instant. Ils apparaîtront ici après ton premier ajout.</EmptyDescription>
            </Empty>
          )}
          <ol className="space-y-1">
            {entries?.map((e) => {
              const isOpen = expanded === e.id
              return (
                <li key={e.id} className="rounded-2xl px-2 py-2 hover:bg-muted/50">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <ServiceLogo service={e.source.service} size={13} />
                        <span className="truncate">{e.source.name}</span>
                        <Icon name="arrowRight" size={12} className="text-muted-foreground" />
                        <ServiceLogo service={e.target.service} size={13} />
                        <span className="truncate">{e.target.name}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {dateFmt.format(new Date(e.date))}, {MODE_LABEL[e.mode].toLowerCase()}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge variant="secondary" className="tnum">+{e.added}</Badge>
                      {e.notFound.length > 0 && (
                        <button onClick={() => setExpanded(isOpen ? null : e.id)} className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
                          <Badge variant="destructive" className="tnum">
                            {e.notFound.length} introuvable{e.notFound.length > 1 ? 's' : ''}
                          </Badge>
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mt-2 rounded-xl bg-muted p-2">
                      <ul className="space-y-1 text-xs">
                        {e.notFound.map((t, i) => (
                          <li key={i} className="truncate">
                            {t.title} <span className="text-muted-foreground">, {t.artists.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => saveCsv(`Introuvables - ${e.source.name}.csv`, notFoundToCsv([e]))}
                      >
                        <Icon name="download" /> Exporter en CSV
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>

        <DialogFooter className={cn(!entries?.length && 'hidden')}>
          {confirmClear ? (
            <>
              <span className="mr-auto self-center text-xs text-muted-foreground">Effacer tout l’historique ?</span>
              <Button variant="outline" onClick={() => setConfirmClear(false)}>
                Garder
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await api.clearHistory()
                  setEntries([])
                  setConfirmClear(false)
                }}
              >
                Effacer
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => setConfirmClear(true)}>
                <Icon name="trash" /> Effacer
              </Button>
              <Button
                variant="outline"
                disabled={!withMissing.length}
                onClick={() => saveCsv('Introuvables - historique.csv', notFoundToCsv(withMissing))}
              >
                <Icon name="download" /> Tous les introuvables en CSV
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
