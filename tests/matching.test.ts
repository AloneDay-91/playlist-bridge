import { describe, expect, it } from 'vitest'
import {
  bestCandidate,
  comparePlaylists,
  normalizeTitle,
  parseIsoDuration,
  sameTrack
} from '../src/shared/matching'
import type { Track } from '../src/shared/types'

let n = 0
const t = (p: Partial<Track> & Pick<Track, 'title' | 'artists'>): Track => ({
  id: String(++n),
  service: 'spotify',
  durationMs: 200_000,
  ...p
})

describe('normalizeTitle', () => {
  it('ignore remasters et featurings', () => {
    expect(normalizeTitle('Here Comes the Sun - Remastered 2009')).toBe('here comes the sun')
    expect(normalizeTitle('Here Comes the Sun', 'Remastered 2009')).toBe('here comes the sun')
    expect(normalizeTitle('Stay (feat. Justin Bieber)')).toBe('stay')
    expect(normalizeTitle('Déjà Vu')).toBe('deja vu')
  })
  it('garde live / remix', () => {
    expect(normalizeTitle('Song - Live')).not.toBe(normalizeTitle('Song'))
    expect(normalizeTitle('Song', 'Live')).toBe(normalizeTitle('Song - Live'))
  })
})

describe('sameTrack', () => {
  it('match par ISRC', () => {
    expect(sameTrack(t({ title: 'A', artists: ['X'], isrc: 'GBAYE0601498' }), t({ title: 'B', artists: ['Y'], isrc: 'gb-aye-06-01498' }))).toBe('isrc')
  })
  it('match par métadonnées malgré ISRC différents', () => {
    const a = t({ title: 'Blinding Lights', artists: ['The Weeknd'], isrc: 'USUG11904206', durationMs: 200_040 })
    const b = t({ service: 'tidal', title: 'Blinding Lights', artists: ['The Weeknd'], isrc: 'USUG12000001', durationMs: 201_000 })
    expect(sameTrack(a, b)).toBe('metadata')
  })
  it('refuse si durée trop différente', () => {
    expect(sameTrack(t({ title: 'Song', artists: ['X'], durationMs: 200_000 }), t({ title: 'Song', artists: ['X'], durationMs: 260_000 }))).toBeNull()
  })
})

describe('comparePlaylists', () => {
  it('classe en commun / manquant / en trop / doublon', () => {
    const shared = t({ title: 'Common', artists: ['A'], isrc: 'AAA000000001' })
    const left = [shared, t({ title: 'Only Left', artists: ['B'] }), t({ title: 'Common', artists: ['A'], isrc: 'AAA000000001' })]
    const right = [t({ service: 'tidal', title: 'Common', artists: ['A'], isrc: 'AAA000000001' }), t({ service: 'tidal', title: 'Only Right', artists: ['C'] })]
    const { stats, rows } = comparePlaylists(left, right)
    expect(stats).toEqual({ both: 1, missing: 1, extra: 1, duplicate: 1 })
    expect(rows.map((r) => r.status)).toEqual(['both', 'missing', 'duplicate', 'extra'])
  })
})

describe('bestCandidate', () => {
  it('choisit le bon résultat de recherche', () => {
    const src = t({ title: 'Get Lucky (feat. Pharrell Williams)', artists: ['Daft Punk', 'Pharrell Williams'], durationMs: 369_000 })
    const res = bestCandidate(src, [
      t({ service: 'tidal', title: 'Get Lucky', version: 'Radio Edit', artists: ['Daft Punk'], durationMs: 248_000 }),
      t({ service: 'tidal', title: 'Get Lucky', artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], durationMs: 369_500 })
    ])
    expect(res?.track.durationMs).toBe(369_500)
  })
  it('renvoie null quand rien ne colle', () => {
    expect(bestCandidate(t({ title: 'Song', artists: ['X'] }), [t({ title: 'Other', artists: ['Y'] })])).toBeNull()
  })
})

it('parseIsoDuration', () => {
  expect(parseIsoDuration('PT3M5S')).toBe(185_000)
  expect(parseIsoDuration('PT1H2M')).toBe(3_720_000)
  expect(parseIsoDuration('PT58.5S')).toBe(58_500)
})
