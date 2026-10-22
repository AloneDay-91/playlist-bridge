import { contextBridge, ipcRenderer } from 'electron'
import type { BridgeApi } from '@shared/api'
import type { ProgressEvent } from '@shared/types'

const api: BridgeApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  redirectUri: () => ipcRenderer.invoke('redirect-uri'),

  accounts: () => ipcRenderer.invoke('accounts'),
  connect: (s) => ipcRenderer.invoke('connect', s),
  disconnect: (s) => ipcRenderer.invoke('disconnect', s),

  playlists: (s) => ipcRenderer.invoke('playlists', s),
  tracks: (s, id, jobId) => ipcRenderer.invoke('tracks', s, id, jobId),
  resolve: (jobId, target, sources, targetTracks) =>
    ipcRenderer.invoke('resolve', jobId, target, sources, targetTracks),
  add: (jobId, target, tracks) => ipcRenderer.invoke('add', jobId, target, tracks),
  searchTracks: (s, query) => ipcRenderer.invoke('search', s, query),
  saveMatch: (source, target, match) => ipcRenderer.invoke('match:save', source, target, match),
  peekMatches: (target, sources) => ipcRenderer.invoke('match:peek', target, sources),

  history: () => ipcRenderer.invoke('history'),
  recordHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  exportCsv: (filename, csv) => ipcRenderer.invoke('export-csv', filename, csv),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onProgress: (cb) => {
    const listener = (_e: unknown, payload: ProgressEvent): void => cb(payload)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
