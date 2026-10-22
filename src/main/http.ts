import type { Service } from '@shared/types'
import { refresh } from './oauth'
import { getToken, saveToken, type TokenSet } from './store'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ClientOptions {
  service: Service
  baseUrl: string
  tokenUrl: string
  clientId: () => string
  defaultHeaders?: Record<string, string>
}

/**
 * Petit client HTTP authentifié :
 * - rafraîchit le token avant expiration ou sur 401
 * - respecte Retry-After sur 429 et retente les 5xx
 */
export class ApiClient {
  constructor(private opts: ClientOptions) {}

  private async token(force = false): Promise<TokenSet> {
    const t = getToken(this.opts.service)
    if (!t) throw new ApiError(401, 'Pas connecté')
    if (!force && t.expiresAt > Date.now()) return t
    const next = await refresh(this.opts.tokenUrl, this.opts.clientId(), t)
    saveToken(this.opts.service, next)
    return next
  }

  url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = path.startsWith('http') ? new URL(path) : new URL(this.opts.baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
    }
    return u.toString()
  }

  async request<T>(
    method: string,
    path: string,
    { query, body }: { query?: Record<string, string | number | undefined>; body?: unknown } = {}
  ): Promise<T> {
    const url = this.url(path, query)
    let forced = false
    for (let attempt = 0; attempt < 6; attempt++) {
      const tok = await this.token(forced)
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          ...this.opts.defaultHeaders,
          ...(body !== undefined
            ? { 'Content-Type': this.opts.defaultHeaders?.Accept ?? 'application/json' }
            : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })

      if (res.status === 401 && !forced) {
        forced = true
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        const retry = Number(res.headers.get('Retry-After'))
        await sleep(Number.isFinite(retry) && retry > 0 ? retry * 1000 : 800 * 2 ** attempt)
        continue
      }
      const text = await res.text()
      const json = text ? safeJson(text) : undefined
      if (!res.ok) throw new ApiError(res.status, describe(res.status, json), json)
      return json as T
    }
    throw new ApiError(429, 'Trop de requêtes, réessaie dans un moment.')
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query })
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body })
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function describe(status: number, json: unknown): string {
  const j = json as Record<string, any> | undefined
  const detail =
    j?.error?.message ?? j?.errors?.[0]?.detail ?? j?.errors?.[0]?.title ?? j?.error_description
  return `Erreur API ${status}${detail ? ` : ${detail}` : ''}`
}

/** Exécute `fn` sur chaque élément avec une concurrence limitée */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size))
