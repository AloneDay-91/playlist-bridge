import type { AddedTrack, Playlist, Service, Track } from '@shared/types'

export interface MusicProvider {
  service: Service
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConfigured(): boolean
  isConnected(): boolean
  me(): Promise<{ id: string; displayName: string }>
  /** Playlists modifiables + playlist virtuelle des titres likés (id = LIKED_ID) */
  listPlaylists(): Promise<Playlist[]>
  getTracks(playlistId: string, onProgress?: (loaded: number, total?: number) => void): Promise<Track[]>
  searchByIsrc(isrc: string): Promise<Track[]>
  searchText(title: string, artist: string): Promise<Track[]>
  /** Recherche libre (correction manuelle) */
  search(query: string): Promise<Track[]>
  createPlaylist(name: string, description?: string): Promise<Playlist>
  addTracks(
    playlistId: string,
    tracks: Track[],
    onProgress?: (done: number) => void,
    /** Ajoute aussi les titres déjà présents dans la playlist */
    allowDuplicates?: boolean
  ): Promise<{ added: number; skipped: number; tracks: AddedTrack[] }>
  removeTracks(playlistId: string, tracks: AddedTrack[]): Promise<number>
}
