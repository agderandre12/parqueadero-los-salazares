import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const aqui = fileURLToPath(new URL('.', import.meta.url))

/** Empaqueta la prueba de integración para ejecutarla dentro de Electron. */
export default defineConfig({
  build: {
    ssr: `${aqui}liquidacion.js`,
    outDir: `${aqui}../out/pruebas`,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: ['electron', /^node:/],
      output: { format: 'cjs', entryFileNames: 'index.cjs' }
    }
  }
})
