import type { BridgeApi } from '../shared/api'

declare global {
  interface Window {
    api: BridgeApi
  }
}

export {}
