import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * `npm run dev`      → localhost, HTTP. Suficiente: localhost ya es contexto seguro.
 * `npm run dev:lan`  → expuesto en la red, HTTPS con certificado autofirmado.
 *
 * El HTTPS no es capricho: Web Serial solo existe en contexto seguro. Servido por
 * IP sin TLS, `navigator.serial` es undefined y la app no puede abrir el puerto.
 */
const lan = process.env.LAN === '1'

/**
 * GitHub Pages serves a project site under `/<repo>/`, so every asset URL has
 * to carry that prefix. The workflow exports GITHUB_REPOSITORY (`owner/repo`);
 * locally it is unset and the app builds for `/`. A user or org site
 * (`<owner>.github.io`) is the exception and lives at the root.
 */
function pagesBase(): string {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (!repo || repo.endsWith('.github.io')) return '/'
  return `/${repo}/`
}

export default defineConfig({
  base: pagesBase(),
  plugins: [react(), tailwindcss(), ...(lan ? [basicSsl()] : [])],
  server: {
    host: lan,
    port: 5173,
  },
})
