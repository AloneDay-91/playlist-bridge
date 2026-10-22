import { createToastManager } from '@/components/ui/Toast'
import { api } from './api'

/** Gestionnaire de toasts partagé (Lumen UI / Base UI) */
export const toasts = createToastManager()

export const notify = (title: string, description?: string): void => void toasts.add({ title, description })

export const fail = (e: unknown): void =>
  notify('Ça n’a pas marché', (e as Error)?.message ?? String(e))

/** Exporte un CSV et dit clairement ce qui s'est passé */
export async function saveCsv(filename: string, csv: string): Promise<void> {
  try {
    const res = await api.exportCsv(filename, csv)
    if (res === 'saved') notify('CSV enregistré', filename)
    else if (res === 'copied') notify('CSV copié dans le presse-papiers', 'Colle-le dans un tableur. L’enregistrement en fichier se fait dans l’app desktop.')
    else if (res === 'unavailable') notify('Export indisponible ici', 'Dans l’app desktop, le CSV s’enregistre où tu veux.')
  } catch (e) {
    fail(e)
  }
}
