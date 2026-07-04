import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    cesium()
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
})
