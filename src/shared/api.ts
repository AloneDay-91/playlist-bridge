import type {
  AccountStatus,
  AddResult,
  AddTarget,
  AppSettings,
  ExportResult,
  HistoryEntry,
  Playlist,
  ProgressEvent,
  Resolution,
  Service,
  Track
} from './types'

/** Ce que l'app desktop expose au renderer (implémenté par `src/main/bridge.ts`). */
export interface BridgeApi {
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  redirectUri(): Promise<string>

  accounts(): Promise<AccountStatus[]>
  connect(service: Service): Promise<AccountStatus>
  disconnect(service: Service): Promise<void>

  /** Inclut la playlist virtuelle des titres likés (id = LIKED_ID) */
  playlists(service: Service): Promise<Playlist[]>
  tracks(service: Service, playlistId: string, jobId?: string): Promise<Track[]>

  /** Trouve chaque titre source sur la plateforme cible (mémoire des correspondances incluse) */
  resolve(
    jobId: string,
    target: Service,
    sources: { key: string; track: Track }[],
    targetTracks: Track[]
  ): Promise<Resolution[]>

  /** Recherche libre dans le catalogue, pour la correction manuelle */
  searchTracks(service: Service, query: string): Promise<Track[]>
  /** Mémorise « ce titre source = ce titre cible » pour les prochaines fois */
  saveMatch(source: Track, target: Service, match: Track): Promise<void>
  /** Correspondances déjà mémorisées, sans appel réseau (null = inconnue) */
  peekMatches(target: Service, sources: Track[]): Promise<(Track | null)[]>

  add(jobId: string, target: AddTarget, tracks: Track[], options?: { allowDuplicates?: boolean }): Promise<AddResult>
  /** Retire de la playlist cible les titres d'une entrée d'historique */
  undo(entryId: string): Promise<HistoryEntry>

  history(): Promise<HistoryEntry[]>
  recordHistory(entry: HistoryEntry): Promise<void>
  clearHistory(): Promise<void>

  /** Enregistre un CSV (boîte de dialogue en desktop, presse-papiers en démo) */
  exportCsv(filename: string, csv: string): Promise<ExportResult>

  openExternal(url: string): Promise<void>
  onProgress(cb: (e: ProgressEvent) => void): () => void
}
