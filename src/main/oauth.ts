import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { TokenSet } from './store'

export const REDIRECT_PORT = 8888
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

interface OAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  scopes: string
  /** Paramètres en plus sur l'URL d'autorisation */
  extraParams?: Record<string, string>
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256b64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return b64url(new Uint8Array(digest))
}

async function postForm(url: string, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(
      `Échec du token (${res.status}) : ${String(json.error_description ?? json.error ?? '')}`
    )
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000,
    scope: json.scope ? String(json.scope) : undefined
  }
}

/** Flow Authorization Code + PKCE, sans secret client (adapté à une app desktop) */
export async function authorize(cfg: OAuthConfig): Promise<TokenSet> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)))
  const challenge = await sha256b64url(verifier)
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))

  const url = new URL(cfg.authorizeUrl)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    ...cfg.extraParams
  })
  const scopes = cfg.scopes.trim()
  if (scopes) params.set('scope', scopes)
  // TIDAL ne découpe pas les scopes séparés par « + ».
  url.search = params.toString().replace(/\+/g, '%20')

  // Le serveur local est côté Rust : la webview ne peut pas écouter un port.
  const codePromise = invoke<string>('oauth_wait_code', { state })
  await openUrl(url.toString())
  const code = await codePromise

  return postForm(cfg.tokenUrl, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: cfg.clientId,
    code_verifier: verifier
  })
}

export async function refresh(
  tokenUrl: string,
  clientId: string,
  token: TokenSet
): Promise<TokenSet> {
  if (!token.refreshToken) throw new Error('Session expirée, reconnecte-toi.')
  const next = await postForm(tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: clientId
  })
  // Certains serveurs ne renvoient pas de nouveau refresh token
  return { ...next, refreshToken: next.refreshToken ?? token.refreshToken }
}
