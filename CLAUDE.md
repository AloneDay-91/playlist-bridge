# Playlist Bridge

App desktop Electron pour transférer et synchroniser des playlists entre Spotify et TIDAL, sans doublons. Usage perso. Tout le texte de l'interface est en français.

## Commandes

```bash
npm install
npm run dev          # app Electron en dev
npm run demo         # interface seule dans le navigateur, données factices (src/renderer/src/lib/demo.ts)
npm run demo:build   # build de la démo publiable (dist-demo/artifact.html)
npm run typecheck    # tsc main/preload/shared + renderer
npm test             # vitest (tests/)
npm run dist         # installeur dans release/
```

Avant de considérer une modif terminée : `npm run typecheck && npm test`.

## Architecture

- `src/main/` : process Electron (Node). Seul endroit qui parle aux API.
  - `providers/spotify.ts`, `providers/tidal.ts` implémentent `MusicProvider` (`providers/types.ts`).
  - `oauth.ts` : Authorization Code + PKCE, callback sur `http://127.0.0.1:8888/callback`. Pas de secret client.
  - `store.ts` : réglages, tokens chiffrés (safeStorage), mémoire des correspondances (`matches.json`), historique (`history.json`) dans `userData`.
  - `resolve.ts` : trouve un titre sur l'autre plateforme (mémoire → ISRC → recherche texte + score).
  - `index.ts` : fenêtre + handlers IPC.
- `src/preload/` : expose `window.api` (type `BridgeApi` dans `src/shared/api.ts`). contextIsolation + sandbox.
- `src/shared/` : types, moteur de comparaison (`matching.ts`), CSV. Importé par main, renderer et tests, donc sans dépendance Node ni DOM.
- `src/renderer/src/` : React 19.
  - `lib/api.ts` choisit `window.api` (Electron) ou `demoApi` (navigateur).
  - Toute nouvelle méthode de `BridgeApi` doit être ajoutée à 4 endroits : `shared/api.ts`, `preload/index.ts`, un handler dans `main/index.ts`, et `lib/demo.ts`.

## UI

- Design system : **Lumen UI** (ui.elouanb.fr). Composants copiés dans `src/renderer/src/components/ui/` via `npx @aloneday/lumenui@latest add <composant>` (config dans `lumen.json`). Réutiliser ces composants plutôt que réécrire des boutons, dialogs, etc.
- Icônes : **RuneIcons** (`runeicons-react`), toujours via `<Icon name="…" />` de `components/Icon.tsx` (table `ICONS` → id Rune). Ne pas réinstaller lucide-react. Pour trouver un id : `searchIcons('mot')` de `runeicons-react`.
- Logos Spotify/TIDAL : `<ServiceLogo />` (logos Rune recadrés, inversés en mode sombre).
- Thème : tokens Lumen dans `styles.css`, clair/sombre via la classe `.dark`. Couleurs de statut du diff : `both` (en commun), `new` (à ajouter), `extra` (seulement dans la cible), `destructive` (introuvable/doublon).
- Modifs faites sur les fichiers Lumen copiés (à refaire si on les régénère) : icônes Rune au lieu de lucide dans Checkbox, Dialog, Toast, Spinner ; toasts en haut à droite (ils masquaient la barre d'action en bas).
- Doit rester utilisable à 390 px de large (la sidebar devient un tiroir).

## API : pièges connus

- **Spotify (mode Développement, depuis février 2026)** : le propriétaire de l'app doit avoir Premium, 5 utilisateurs max. Endpoints `/playlists/{id}/items` (plus `/tracks`), champ `item` (plus `track`), `POST /me/playlists`, `PUT /me/library` (40 URIs max, en query), recherche limitée à 10 résultats. Le contenu n'est lisible que pour les playlists dont on est propriétaire ou collaborateur. `external_ids` (ISRC) est bien renvoyé.
- **TIDAL v2** (`openapi.tidal.com/v2`) : JSON:API, `include=` pour artistes/albums/pochettes, pagination par `page[cursor]`, 20 éléments max par ajout. `me` fonctionne comme id utilisateur. Les variantes d'`include` sont essayées de la plus riche à la plus simple si l'API répond 400.
- Titres likés = playlist virtuelle d'id `LIKED_ID` (`'liked'`) gérée dans chaque provider.

## Matching (`src/shared/matching.ts`)

Même titre si même ISRC, sinon titre normalisé + un artiste en commun + durée à ±4 s. La normalisation retire accents, ligatures (œ, æ), featurings et mentions de remaster, mais garde live/remix/acoustic. Seuil de recherche : `MATCH_THRESHOLD = 0.78`. Toute modif ici doit être couverte par `tests/matching.test.ts`.

## Conventions

- TypeScript strict, pas de `any` sauf pour les réponses JSON brutes des API.
- Commentaires et textes UI en français, phrases courtes, à la voix active.
- Pas de secrets dans le dépôt : les Client ID sont saisis dans les Réglages de l'app.
