// Lance uniquement l'interface dans un navigateur, avec des données factices
// (pratique pour bosser le design sans se connecter aux API).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
      '@main': resolve(import.meta.dirname, 'src/main')
    }
  },
  // Chemins relatifs : le build peut être servi depuis n'importe quel dossier
  base: './',
  build: { outDir: resolve(import.meta.dirname, 'dist-demo'), emptyOutDir: true },
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  plugins: [react(), tailwindcss()]
})
