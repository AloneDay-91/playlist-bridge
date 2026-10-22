import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Field, FieldControl, FieldDescription, FieldLabel } from '@/components/ui/Field'
import { api } from '@/lib/api'
import { Icon } from './Icon'

export function SettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null)
  const [redirect, setRedirect] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    void api.getSettings().then(setS)
    void api.redirectUri().then(setRedirect)
  }, [open])

  const link = (href: string, text: string) => (
    <button type="button" className="text-foreground underline underline-offset-2" onClick={() => api.openExternal(href)}>
      {text}
    </button>
  )

  const field = (label: string, k: keyof AppSettings, hint: ReactNode, placeholder = '') =>
    s && (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <FieldControl value={s[k]} onValueChange={(v) => setS({ ...s, [k]: String(v) })} placeholder={placeholder} spellCheck={false} />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
    )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Réglages</DialogTitle>
          <DialogDescription>Les identifiants de tes deux apps développeur. Les tokens restent chiffrés sur ta machine.</DialogDescription>
        </DialogHeader>

        {s && (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              await api.saveSettings({
                spotifyClientId: s.spotifyClientId.trim(),
                tidalClientId: s.tidalClientId.trim(),
                tidalCountry: s.tidalCountry.trim().toUpperCase(),
                tidalScopes: s.tidalScopes.trim()
              })
              onSaved()
              onClose()
            }}
          >
            <div className="rounded-2xl bg-muted p-3">
              <p className="mb-1 text-xs text-muted-foreground">URL de redirection à déclarer dans les deux apps</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs">{redirect}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copier l'URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(redirect)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} className={copied ? 'text-both' : undefined} />
                </Button>
              </div>
            </div>

            {field(
              'Client ID Spotify',
              'spotifyClientId',
              <>Crée une app sur {link('https://developer.spotify.com/dashboard', 'le dashboard Spotify')} (Web API), ajoute l’URL ci-dessus et ton compte dans User Management.</>
            )}
            {field(
              'Client ID TIDAL',
              'tidalClientId',
              <>Crée une app sur {link('https://developer.tidal.com/dashboard', 'developer.tidal.com')} avec la même URL de redirection.</>
            )}
            {field('Pays du catalogue TIDAL', 'tidalCountry', 'Code à deux lettres. Vide = pays de ton compte.', 'FR')}
            {field('Scopes TIDAL', 'tidalScopes', 'À ajuster seulement si TIDAL refuse la connexion à cause d’un scope.')}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit">Enregistrer</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
