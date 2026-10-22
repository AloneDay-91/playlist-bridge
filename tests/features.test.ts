import { describe, expect, it } from 'vitest'
import { compareToCsv, notFoundToCsv, toCsv, trackUrl } from '../src/shared/csv'
import { comparePlaylists, matchesQuery, searchQueryFor } from '../src/shared/matching'
import { LIKED_ID, type HistoryEntry, type Playlist, type Track } from '../src/shared/types'
import { addedSuffix, sortPlaylists } from '../src/shared/library'
import { findCounterpart, historyEntry } from '../src/renderer/src/lib/transfer'

const t = (p: Partial<Track> & Pick<Track, 'id' | 'title'>): Track => ({
  service: 'spotify',
  artists: ['Stromae'],
  durationMs: 207_000,
  ...p
})

describe('CSV', () => {
  it('échappe le séparateur, les guillemets et les retours ligne', () => {
    expect(toCsv([['a;b', 'dit "salut"', 'ok'], ['x\ny']])).toBe('"a;b";"dit ""salut""";ok\r\n"x\ny"')
  })
  it('liens vers les titres', () => {
    expect(trackUrl({ service: 'spotify', id: 'abc' })).toBe('https://open.spotify.com/track/abc')
    expect(trackUrl({ service: 'tidal', id: '42' })).toBe('https://tidal.com/browse/track/42')
  })
  it('exporte une comparaison avec une ligne par titre', () => {
    const cmp = comparePlaylists([t({ id: '1', title: 'Alors on danse' })], [t({ id: '2', title: 'Papaoutai', service: 'tidal' })])
    const csv = compareToCsv(cmp.rows, new Map(), 'spotify', 'tidal').split('\r\n')
    expect(csv).toHaveLength(3)
    expect(csv[0]).toContain('Titre (Spotify)')
    expect(csv[1]).toMatch(/^Manquant dans la cible;;Alors on danse/)
    expect(csv[2]).toMatch(/^Seulement dans la cible;/)
  })
  it('liste les introuvables', () => {
    const e = { source: { name: 'Route' }, target: { service: 'tidal' }, notFound: [{ title: 'Redbone', artists: ['Childish Gambino'], durationMs: 327_000 }] } as HistoryEntry
    expect(notFoundToCsv([e]).split('\r\n')[1]).toBe('Route;TIDAL;Redbone;Childish Gambino;;5:27;')
  })
})

describe('recherche', () => {
  it('filtre sans tenir compte des accents ni de la casse', () => {
    const track = t({ id: '1', title: 'Comme des enfants', artists: ['Cœur de pirate'] })
    expect(matchesQuery('COEUR', track)).toBe(true) // « œ » déplié en « oe »
    expect(matchesQuery('enfants', track)).toBe(true)
    expect(matchesQuery('', track)).toBe(true)
    expect(matchesQuery('deja', t({ id: '2', title: 'Déjà vu' }))).toBe(true)
  })
  it('construit une requête sans featuring ni remaster', () => {
    expect(searchQueryFor(t({ id: '1', title: 'Get Lucky (feat. Pharrell Williams)', artists: ['Daft Punk'] }))).toBe('Get Lucky Daft Punk')
    expect(searchQueryFor({ title: 'Song', version: 'Live', artists: ['X'] })).toBe('Song Live X')
    expect(searchQueryFor({ title: 'Song', version: 'Remastered 2011', artists: ['X'] })).toBe('Song X')
  })
})

describe('transfert', () => {
  const pl = (p: Partial<Playlist> & Pick<Playlist, 'id' | 'name'>): Playlist => ({ service: 'tidal', editable: true, ...p })
  it('les likés vont dans les likés, sinon même nom (accents et casse ignorés)', () => {
    const cands = [pl({ id: LIKED_ID, name: 'Titres favoris', kind: 'liked' }), pl({ id: 'a', name: 'Dimanche Matin' }), pl({ id: 'b', name: 'Été', editable: false })]
    expect(findCounterpart(pl({ id: LIKED_ID, name: 'Titres likés', kind: 'liked', service: 'spotify' }), cands)?.id).toBe(LIKED_ID)
    expect(findCounterpart(pl({ id: 'x', name: 'dimanche matin' }), cands)?.id).toBe('a')
    expect(findCounterpart(pl({ id: 'y', name: 'ete' }), cands)).toBeUndefined() // lecture seule
  })
  it("l'historique garde les introuvables et compte les déjà présents", () => {
    const src = t({ id: '7', title: 'Redbone' })
    const e = historyEntry({
      mode: 'single',
      source: { service: 'spotify', name: 'A' },
      target: { service: 'tidal', name: 'B' },
      added: 3,
      resolutions: [
        { sourceKey: 'k1', status: 'not-found' },
        { sourceKey: 'k2', status: 'already-there' },
        { sourceKey: 'k3', status: 'found' }
      ],
      sources: new Map([['k1', src]])
    })
    expect(e.notFound).toEqual([{ title: 'Redbone', artists: ['Stromae'], album: undefined, isrc: undefined, durationMs: 207_000 }])
    expect(e.alreadyThere).toBe(1)
  })
})

describe('ordre et annulation', () => {
  const pl = (p: Partial<Playlist> & Pick<Playlist, 'id' | 'name'>): Playlist => ({ service: 'tidal', editable: true, ...p })
  it('trie les playlists de la plus ancienne à la plus récente, likés en tête', () => {
    const sorted = sortPlaylists([
      pl({ id: 'old', name: 'Vieille', updatedAt: '2024-01-01T00:00:00Z' }),
      pl({ id: LIKED_ID, name: 'Titres favoris', kind: 'liked' }),
      pl({ id: 'new', name: 'Récente', updatedAt: '2026-10-01T00:00:00Z' }),
      pl({ id: 'plain', name: 'Sans date' })
    ])
    expect(sorted.map((p) => p.id)).toEqual([LIKED_ID, 'old', 'new', 'plain'])
  })
  it("ne retrouve l'ajout que si le bloc en fin de liste a la bonne taille", () => {
    const at = '2026-10-22T09:56:00.000Z'
    const tracks = [
      t({ id: 'a', title: 'A', addedAt: '2025-01-01T00:00:00Z' }),
      t({ id: 'b', title: 'B', addedAt: '2026-10-22T09:55:59Z' }),
      t({ id: 'c', title: 'C', addedAt: '2026-10-22T09:55:59Z' })
    ]
    expect(addedSuffix(tracks, at, 2)?.map((x) => x.id)).toEqual(['b', 'c'])
    expect(addedSuffix(tracks, at, 3)).toBeNull()
  })
})
