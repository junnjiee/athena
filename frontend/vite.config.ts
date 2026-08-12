import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

const apiTarget = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    cesium()
  ],
  server: {
    // Under docker-compose the terrain service is another container, so the
    // target is set to http://server:8787 there. Defaults to the loopback
    // address used when both run on the host.
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
})
