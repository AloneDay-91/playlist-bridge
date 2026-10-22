import { useEffect, useState, type ReactNode } from 'react'
import { TIDAL_SCOPES, type AppSettings } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
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
    <Button type="button" variant="link" className="h-auto px-0" onClick={() => api.openExternal(href)}>
      {text}
    </Button>
  )

  const field = (label: string, k: keyof AppSettings, hint: ReactNode, placeholder = '') =>
    s && (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Input
          value={s[k]}
          onChange={(e) => setS({ ...s, [k]: e.target.value })}
          placeholder={placeholder}
          spellCheck={false}
        />
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
                tidalScopes: s.tidalScopes.trim() || TIDAL_SCOPES
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
              'App Web API. Ajoute l’URL ci-dessus et ton compte dans User Management.'
            )}
            {link('https://developer.spotify.com/dashboard', 'Dashboard Spotify')}
            {field(
              'Client ID TIDAL',
              'tidalClientId',
              'Même URL de redirection. Active ensuite les scopes de l’app.'
            )}
            {link('https://developer.tidal.com/dashboard', 'Dashboard TIDAL')}
            {field('Pays du catalogue TIDAL', 'tidalCountry', 'Code à deux lettres. Vide = pays de ton compte.', 'FR')}
            {field(
              'Scopes TIDAL',
              'tidalScopes',
              'Playlists et favoris. Ajoute user.read ou search.read seulement s’ils sont activés sur l’app : sinon TIDAL refuse toute la connexion (erreur 1002).'
            )}
            <Button type="button" variant="outline" onClick={() => s && setS({ ...s, tidalScopes: TIDAL_SCOPES })}>
              Scopes par défaut
            </Button>

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
