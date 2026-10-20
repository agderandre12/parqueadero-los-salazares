/*
 * Genera el ícono del instalador y del ejecutable a partir del emblema.
 *
 *   npm run icono
 *
 * El emblema es circular sobre fondo negro: se recorta en círculo con las
 * esquinas transparentes para que en el escritorio y la barra de tareas no se
 * vea un cuadro negro. Se usa `nativeImage` de Electron para no sumar una
 * librería de imágenes sólo para esto.
 *
 * Salida: build/icon.ico (16 a 256 px, lo usa electron-builder) y
 * build/icon.png (512 px, referencia).
 */
const { app, nativeImage } = require('electron')
const { writeFileSync, mkdirSync } = require('fs')
const { join, resolve } = require('path')

const raiz = resolve(__dirname, '..')
const entrada = join(raiz, 'iconoparqueadero.jpeg')
const salida = join(raiz, 'build')

// Fracción del lado que ocupa el círculo: deja fuera las esquinas negras sin
// recortar el aro azul del emblema.
const RADIO = 0.49
const TAMANOS_ICO = [16, 24, 32, 48, 64, 128, 256]

function recortarCirculo(imagen) {
  const { width: w, height: h } = imagen.getSize()
  const bmp = Buffer.from(imagen.toBitmap()) // BGRA premultiplicado
  const radio = Math.min(w, h) * RADIO

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2)
      const a = Math.max(0, Math.min(1, radio - d + 0.5)) // borde suavizado de 1 px
      const i = (y * w + x) * 4
      for (let c = 0; c < 4; c++) bmp[i + c] = Math.round(bmp[i + c] * a)
    }
  }
  return nativeImage.createFromBitmap(bmp, { width: w, height: h })
}

/** ICO con entradas PNG (formato admitido desde Windows Vista). */
function armarIco(pngs) {
  const cabecera = Buffer.alloc(6 + 16 * pngs.length)
  cabecera.writeUInt16LE(1, 2) // tipo: ícono
  cabecera.writeUInt16LE(pngs.length, 4)

  let desplazamiento = cabecera.length
  pngs.forEach(({ tam, datos }, k) => {
    const o = 6 + 16 * k
    cabecera.writeUInt8(tam === 256 ? 0 : tam, o) // 0 significa 256
    cabecera.writeUInt8(tam === 256 ? 0 : tam, o + 1)
    cabecera.writeUInt16LE(1, o + 4) // planos
    cabecera.writeUInt16LE(32, o + 6) // bits por píxel
    cabecera.writeUInt32LE(datos.length, o + 8)
    cabecera.writeUInt32LE(desplazamiento, o + 12)
    desplazamiento += datos.length
  })
  return Buffer.concat([cabecera, ...pngs.map((p) => p.datos)])
}

app.whenReady().then(() => {
  const emblema = nativeImage.createFromPath(entrada)
  if (emblema.isEmpty()) {
    console.error(`No se pudo leer ${entrada}`)
    app.exit(1)
    return
  }

  const circular = recortarCirculo(emblema)
  const png = (tam) => circular.resize({ width: tam, height: tam, quality: 'best' }).toPNG()

  mkdirSync(salida, { recursive: true })
  writeFileSync(join(salida, 'icon.png'), png(512))
  writeFileSync(join(salida, 'icon.ico'), armarIco(TAMANOS_ICO.map((tam) => ({ tam, datos: png(tam) }))))

  console.log(`Ícono generado en ${salida} (${TAMANOS_ICO.join(', ')} px)`)
  app.quit()
})
