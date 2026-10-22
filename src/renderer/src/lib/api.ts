import type { BridgeApi } from '@shared/api'
import { demoApi } from './demo'

/** Dans Electron : le vrai pont IPC. Dans un navigateur (npm run demo) : données factices. */
export const api: BridgeApi =
  typeof window !== 'undefined' && window.api ? window.api : demoApi

export const isDemo = api === demoApi

export const newJobId = (): string => Math.random().toString(36).slice(2, 10)
