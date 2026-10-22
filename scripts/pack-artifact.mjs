// Transforme le build de démo (dist-demo/) en page publiable comme Artifact :
// l'hôte fournit déjà <!doctype>, <html>, <head> et <body>, on ne garde donc
// que le titre, les balises de styles/scripts et le point de montage.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'dist-demo')
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? ''
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Playlist Bridge</title>'
const assets = [...head.matchAll(/<(script|link)\b[^>]*>(?:<\/script>)?/g)]
  .map((m) => m[0])
  .filter((t) => !/http-equiv/.test(t))

writeFileSync(
  join(dir, 'artifact.html'),
  [title, ...assets, '<div id="root"></div>', ''].join('\n')
)
console.log('dist-demo/artifact.html prêt :', assets.length, 'balises')
