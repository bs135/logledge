import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Tauri CLI output visible in the terminal during `tauri dev`.
  clearScreen: false,
  server: {
    // tauri.conf.json devUrl points at this port, so it must not drift.
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
