import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AccountStatus,
  AddTarget,
  AppSettings,
  ExportResult,
  HistoryEntry,
  ProgressEvent,
  Service,
  Track
} from '@shared/types'
import { REDIRECT_URI } from './oauth'
import { SpotifyProvider } from './providers/spotify'
import { TidalProvider } from './providers/tidal'
import type { MusicProvider } from './providers/types'
import { resolveTracks } from './resolve'
import { addHistory, clearHistory, getHistory, getMatch, getSettings, saveSettings, setMatches } from './store'

const providers: Record<Service, MusicProvider> = {
  spotify: new SpotifyProvider(),
  tidal: new TidalProvider()
}

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0c0d10',
    title: 'Playlist Bridge',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })

  // Les liens externes s'ouvrent dans le navigateur, pas dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

const progress = (e: ProgressEvent): void => win?.webContents.send('progress', e)

async function status(service: Service): Promise<AccountStatus> {
  const p = providers[service]
  const base = { service, configured: p.isConfigured(), connected: p.isConnected() }
  if (!base.connected) return base
  try {
    return { ...base, displayName: (await p.me()).displayName }
  } catch {
    // Token révoqué ou expiré sans refresh possible
    return { ...base, connected: false }
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => saveSettings(patch))
  ipcMain.handle('redirect-uri', () => REDIRECT_URI)

  ipcMain.handle('accounts', () => Promise.all([status('spotify'), status('tidal')]))
  ipcMain.handle('connect', async (_e, s: Service) => {
    await providers[s].connect()
    win?.focus()
    return status(s)
  })
  ipcMain.handle('disconnect', (_e, s: Service) => providers[s].disconnect())

  ipcMain.handle('playlists', (_e, s: Service) => providers[s].listPlaylists())

  ipcMain.handle('tracks', (_e, s: Service, id: string, jobId?: string) =>
    providers[s].getTracks(id, (done, total) => {
      if (jobId) progress({ jobId, phase: 'loading', done, total: total ?? 0 })
    })
  )

  ipcMain.handle(
    'resolve',
    (_e, jobId: string, target: Service, sources: { key: string; track: Track }[], targetTracks: Track[]) =>
      resolveTracks(providers[target], sources, targetTracks, (done) =>
        progress({ jobId, phase: 'resolving', done, total: sources.length })
      )
  )

  ipcMain.handle('add', async (_e, jobId: string, target: AddTarget, tracks: Track[]) => {
    const p = providers[target.service]
    const playlistId =
      'create' in target
        ? (await p.createPlaylist(target.create.name, target.create.description)).id
        : target.playlistId
    const res = await p.addTracks(playlistId, tracks, (done) =>
      progress({ jobId, phase: 'adding', done, total: tracks.length })
    )
    progress({ jobId, phase: 'done', done: tracks.length, total: tracks.length })
    return { playlistId, ...res }
  })

  ipcMain.handle('search', (_e, s: Service, query: string) => providers[s].search(query))
  ipcMain.handle('match:save', (_e, source: Track, target: Service, match: Track) =>
    setMatches([{ source, target, match }])
  )

  ipcMain.handle('match:peek', (_e, target: Service, sources: Track[]) =>
    sources.map((s) => (s.service === target ? null : (getMatch(s, target) ?? null)))
  )

  ipcMain.handle('history', () => getHistory())
  ipcMain.handle('history:add', (_e, entry: HistoryEntry) => addHistory(entry))
  ipcMain.handle('history:clear', () => clearHistory())

  ipcMain.handle('export-csv', async (_e, filename: string, csv: string): Promise<ExportResult> => {
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: filename.replace(/[\\/:*?"<>|]/g, '-'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return 'cancelled'
    // BOM UTF-8 : Excel ouvre les accents correctement
    await writeFile(filePath, '\ufeff' + csv, 'utf8')
    return 'saved'
  })

  ipcMain.handle('open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
