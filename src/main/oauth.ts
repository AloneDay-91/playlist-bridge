import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
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

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const PAGE = (title: string, body: string): string => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<body style="font-family:system-ui;background:#0e0f12;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p style="opacity:.7">${body}</p></div>`

let activeServer: Server | null = null

/** Attend la redirection OAuth sur 127.0.0.1 et renvoie le `code` */
function waitForCode(expectedState: string, timeoutMs = 5 * 60_000): Promise<string> {
  activeServer?.close()
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error || !code || state !== expectedState) {
        res.end(PAGE('Connexion refusée', error ?? 'Réponse invalide, réessaie depuis l’app.'))
        finish(() => reject(new Error(error ?? 'Réponse OAuth invalide')))
      } else {
        res.end(PAGE('C’est bon ✅', 'Tu peux fermer cet onglet et revenir sur Playlist Bridge.'))
        finish(() => resolve(code))
      }
    })
    const timer = setTimeout(
      () => finish(() => reject(new Error('Connexion expirée (5 min)'))),
      timeoutMs
    )
    function finish(cb: () => void): void {
      clearTimeout(timer)
      server.close()
      if (activeServer === server) activeServer = null
      cb()
    }
    server.on('error', (e) => finish(() => reject(e)))
    server.listen(REDIRECT_PORT, '127.0.0.1')
    activeServer = server
  })
}

async function postForm(url: string, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
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
  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const url = new URL(cfg.authorizeUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: REDIRECT_URI,
    scope: cfg.scopes,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    ...cfg.extraParams
  }).toString()

  const codePromise = waitForCode(state)
  await shell.openExternal(url.toString())
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
