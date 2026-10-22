# Playlist Bridge

App desktop Tauri pour transférer et synchroniser des playlists entre Spotify et TIDAL, sans doublons. Usage perso. Tout le texte de l'interface est en français. Rust doit être installé (`rustc` 1.90+).

## Commandes

```bash
npm install
npm run dev          # app Tauri en dev (webview système + Vite)
npm run demo         # interface seule dans le navigateur, données factices (src/renderer/src/lib/demo.ts)
npm run demo:build   # build de la démo publiable (dist-demo/artifact.html)
npm run typecheck    # tsc shared/renderer/main + configs
npm test             # vitest (tests/)
npm run dist         # installeur Tauri (dmg / exe / AppImage)
```

Avant de considérer une modif terminée : `npm run typecheck && npm test`.

## Architecture

- `src-tauri/` : process natif (Rust). Fenêtre, serveur de callback OAuth sur `127.0.0.1:8888`, tokens dans le trousseau, boîte d'export CSV. Pas de secret client.
- `src/main/` : logique métier, exécutée dans la webview. Seul endroit qui parle aux API (via le plugin HTTP de Tauri, pas le `fetch` du navigateur : sinon CORS).
  - `providers/spotify.ts`, `providers/tidal.ts` implémentent `MusicProvider` (`providers/types.ts`).
  - `oauth.ts` : Authorization Code + PKCE. Le `code` revient par la commande Rust `oauth_wait_code`.
  - `store.ts` : réglages, mémoire des correspondances (`matches.json`), historique (`history.json`) dans le dossier de l'app. Tokens via le trousseau (`token_get` / `token_set`).
  - `http.ts` : client HTTP authentifié (refresh du token, 429 Retry-After, retries des 5xx).
  - `resolve.ts` : trouve un titre sur la cible (même service → id tel quel, sinon mémoire → ISRC → recherche texte + score).
  - `bridge.ts` : implémente `BridgeApi` (`src/shared/api.ts`).
- `src/shared/` : types, moteur de comparaison (`matching.ts`), CSV. Importé par main, renderer et tests, donc sans dépendance Node ni DOM.
- `src/renderer/src/` : React 19.
  - `lib/api.ts` choisit le pont Tauri ou `demoApi` (navigateur).
  - `lib/transfer.ts` : appariement des playlists et historique pour le transfert groupé.
  - Toute nouvelle méthode de `BridgeApi` doit être ajoutée à 3 endroits : `shared/api.ts`, `main/bridge.ts`, et `lib/demo.ts`.

## UI

- Design system : **Lumen UI** (ui.elouanb.fr). Composants copiés dans `src/renderer/src/components/ui/` via `npx @aloneday/lumenui@latest add <composant>` (config dans `lumen.json`). Réutiliser ces composants plutôt que réécrire des boutons, dialogs, etc.
- Icônes : **RuneIcons** (`runeicons-react`), toujours via `<Icon name="…" />` de `components/Icon.tsx` (table `ICONS` → id Rune). Ne pas réinstaller lucide-react. Pour trouver un id : `searchIcons('mot')` de `runeicons-react`.
- Logos Spotify/TIDAL : `<ServiceLogo />` (logos Rune recadrés, inversés en mode sombre).
- Thème : tokens Lumen dans `styles.css`. La classe `.dark` suit le thème du système, sauf si `data-theme` est posé sur `<html>`. Statuts de comparaison : `both` (en commun), `missing` (à ajouter, couleur `--new`), `extra` (seulement dans la cible), `duplicate`. Introuvable et doublon utilisent `--destructive`.
- Modifs faites sur les fichiers Lumen copiés (à refaire si on les régénère) : icônes Rune au lieu de lucide dans Checkbox, Dialog, Toast, Spinner ; toasts en haut à droite (ils masquaient la barre d'action en bas).
- Doit rester utilisable à 390 px de large (la sidebar devient un tiroir).

## API : pièges connus

- **Spotify (mode Développement, depuis février 2026)** : le propriétaire de l'app doit avoir Premium, 5 utilisateurs max. Endpoints `/playlists/{id}/items` (plus `/tracks`), champ `item` (plus `track`), `POST /me/playlists`, `PUT /me/library` (40 URIs max, en query), recherche limitée à 10 résultats. Le contenu n'est lisible que pour les playlists dont on est propriétaire ou collaborateur. `external_ids` (ISRC) est bien renvoyé.
- **TIDAL v2** (`openapi.tidal.com/v2`) : JSON:API, `include=` pour artistes/albums/pochettes, pagination par `page[cursor]`, 20 éléments max par ajout. `me` fonctionne comme id utilisateur. Les variantes d'`include` sont essayées de la plus riche à la plus simple si l'API répond 400.
- Titres likés = playlist virtuelle d'id `LIKED_ID` (`'liked'`) gérée dans chaque provider.

## Matching (`src/shared/matching.ts`)

Même titre si même ISRC, sinon titre normalisé + un artiste en commun + durée à ±4 s. Une durée absente n'empêche pas ce rapprochement. La normalisation retire accents, ligatures (œ, æ), featurings et mentions de remaster, mais garde live, remix, acoustic et edit. Seuil de recherche : `MATCH_THRESHOLD = 0.78`. Toute modif ici doit être couverte par `tests/matching.test.ts`.

## Conventions

- TypeScript strict, pas de `any` sauf pour les réponses JSON brutes des API.
- Commentaires et textes UI en français, phrases courtes, à la voix active.
- Pas de secrets dans le dépôt : les Client ID sont saisis dans les Réglages de l'app.
