# Playlist Bridge

App desktop (Electron) pour transférer et synchroniser des playlists entre **TIDAL** et **Spotify**, dans les deux sens, sans créer de doublons.

## Fonctionnalités

- **Comparaison visuelle** : les deux playlists côte à côte, titre par titre, alignées. En commun, manquant, seulement dans la cible, doublons de la source.
- **Transfert sans doublons** : tu coches, l'app cherche chaque titre sur l'autre plateforme (ISRC puis titre + artiste), puis l'ajoute à une playlist existante ou à une nouvelle.
- **Sync dans les deux sens** : « Dans les deux sens » ajoute aussi à la source les titres qui ne sont que dans la cible.
- **Titres likés** : « Titres likés » (Spotify) et « Titres favoris » (TIDAL) s'utilisent comme n'importe quelle playlist, en source ou en cible.
- **Correction manuelle** : « Choisir » / « Changer » ouvre une recherche sur la plateforme cible, avec un score de ressemblance. Le choix est mémorisé, dans les deux sens.
- **Mémoire des correspondances** : chaque titre trouvé est retenu, donc une resynchro plus tard est instantanée et ne repropose pas ce qui a déjà été apparié.
- **Transfert groupé** : plusieurs playlists d'un coup. Les likés vont dans les likés, et une playlist du même nom est complétée plutôt que dupliquée (désactivable). Rapport à la fin.
- **Recherche et liens** : filtre texte sur la comparaison, et chaque titre s'ouvre dans Spotify ou TIDAL.
- **Export CSV** : la comparaison affichée, ou la liste des introuvables (format Excel français, séparateur `;`).
- **Historique** : chaque ajout, avec ses introuvables, exportables en CSV.
- UI construite avec **Lumen UI** (ui.elouanb.fr), icônes et logos **RuneIcons** (runeicons.com).

## Démarrage

```bash
npm install
npm run dev        # lance l'app Electron
npm run demo       # juste l'interface dans le navigateur, avec des fausses données
npm run demo:build # build de la démo, prêt à publier comme page hébergée (dist-demo/)
npm test           # tests du moteur de comparaison
npm run dist       # build + installeur (dmg / exe / AppImage) dans release/
```

## Configurer les comptes (une seule fois)

L'app utilise OAuth avec PKCE, donc **pas de secret client** à stocker : seulement les Client ID.
URL de redirection à déclarer des deux côtés : **`http://127.0.0.1:8888/callback`**

### Spotify

1. https://developer.spotify.com/dashboard → *Create app*, coche **Web API**.
2. Redirect URI : `http://127.0.0.1:8888/callback` (Spotify n'accepte plus `localhost`, il faut bien `127.0.0.1`).
3. *User Management* : ajoute l'e-mail de ton compte Spotify.
4. Copie le **Client ID** dans *Réglages* de l'app.

> Depuis février 2026, le mode Développement exige que le propriétaire de l'app ait **Spotify Premium**, et limite l'app à 5 utilisateurs autorisés. Pour un usage perso, aucun souci.

### TIDAL

1. https://developer.tidal.com/dashboard → crée une app.
2. Redirect URI : `http://127.0.0.1:8888/callback`.
3. Copie le **Client ID** dans *Réglages*.

Scopes demandés par défaut : `user.read playlists.read playlists.write search.read collection.read collection.write` (les deux derniers servent aux titres favoris).

> Tu t'étais connecté avant l'ajout des titres likés ? Déconnecte puis reconnecte Spotify et TIDAL une fois, pour autoriser l'accès à la bibliothèque. Si TIDAL refuse la connexion à cause d'un scope, ajuste-les dans *Réglages*.

## Comment marche la comparaison

Fichier clé : `src/shared/matching.ts` (testé dans `tests/matching.test.ts`).

1. **ISRC** : l'identifiant universel d'un enregistrement. Même ISRC des deux côtés = même titre.
2. Sinon **titre normalisé + un artiste en commun + durée à ±4 s**. La normalisation retire les accents, les *feat.* et les mentions de *remaster*, mais garde *live*, *remix*, *acoustic* : ce sont d'autres enregistrements. Ça couvre aussi les rééditions single/album qui ont des ISRC différents.
3. Pour trouver un titre sur l'autre plateforme (`src/main/resolve.ts`) : recherche par ISRC d'abord, puis recherche texte avec un score de similarité (titre, artistes, durée). En dessous de 0,78, le titre est marqué **introuvable** avec un lien pour chercher à la main.
4. Avant l'ajout, chaque résultat est re-vérifié contre la cible : s'il y est déjà sous une autre version, il est marqué **déjà là** et décoché. Côté TIDAL, l'ajout se fait en plus avec `onDuplicates: SKIP`.

## Architecture

```
src/
  main/                 process Electron (Node)
    index.ts            fenêtre + IPC
    oauth.ts            OAuth PKCE, serveur de callback sur 127.0.0.1:8888
    store.ts            réglages, tokens chiffrés (safeStorage), mémoire des correspondances, historique
    http.ts             client HTTP : refresh du token, 429 Retry-After, retries
    resolve.ts          recherche d'un titre sur la plateforme cible
    providers/
      spotify.ts        Web API (endpoints /items et POST /me/playlists de 2026)
      tidal.ts          API v2 openapi.tidal.com (JSON:API, include=, pagination par curseur)
  preload/              pont sécurisé window.api (contextIsolation + sandbox)
  shared/               types + moteur de comparaison (utilisé par main, renderer et tests)
  renderer/src/
    components/ui/      composants Lumen UI (copiés par la CLI, cf. lumen.json)
    components/         Sidebar, CompareRows, MatchDialog, BatchDialog, HistoryDialog, PlaylistPicker…
    lib/transfer.ts     historique + appariement des playlists pour le transfert groupé
    lib/demo.ts         fausses données pour `npm run demo`
```

### Lumen UI

Les composants sont copiés dans `src/renderer/src/components/ui` via la CLI (`lumen.json` pointe vers ce dossier). Pour en ajouter un :

```bash
npx @aloneday/lumenui@latest add select
```

Ajustements faits sur les fichiers copiés :
- icônes lucide de `Checkbox`, `Dialog`, `Toast` et `Spinner` remplacées par RuneIcons (lucide n'est plus une dépendance) ;
- toasts déplacés en haut à droite, pour ne pas masquer la barre d'action en bas.

Thème : tokens Lumen (`styles.css`), clair/sombre selon l'OS. Deux tokens ajoutés pour le diff : `--both` (en commun) et `--extra` (seulement dans la cible). « À ajouter » utilise `--new`, « introuvable / doublon » `--destructive`.

### RuneIcons

`src/renderer/src/components/Icon.tsx` centralise les noms d'icônes (`<Icon name="search" />`). `RuneIcon` ne transmet pas `className`, donc le composant l'enveloppe dans un `span`. Les logos Spotify et TIDAL viennent de `runeicons-react/brands` (recadrés sur le symbole et inversés en mode sombre, car dessinés en noir).

`runeicons-react` embarque tout le set d'icônes, ce qui donne un bundle renderer d'environ 8 Mo. Sans impact notable en desktop ; si ça devient gênant, on peut générer un sous-ensemble avec `getIconById` + `buildSvg`.

## Limites connues

- Spotify (mode Développement) ne renvoie le contenu que des playlists dont tu es propriétaire ou collaborateur. Les playlists suivies d'autres utilisateurs n'apparaissent pas comme source.
- Les fichiers locaux Spotify et les clips vidéo TIDAL sont ignorés (non transférables).
- Les playlists TIDAL en favori sont listées en lecture seule (utilisables comme source).
