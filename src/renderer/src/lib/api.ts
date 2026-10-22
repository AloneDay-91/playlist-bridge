import type { BridgeApi } from '@shared/api'
import { createDesktopApi } from '@main/bridge'
import { demoApi } from './demo'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Dans Tauri : le pont local. Dans un navigateur (`npm run demo`) : données factices. */
export const api: BridgeApi = inTauri ? createDesktopApi() : demoApi

export const isDemo = !inTauri

export const newJobId = (): string => Math.random().toString(36).slice(2, 10)
