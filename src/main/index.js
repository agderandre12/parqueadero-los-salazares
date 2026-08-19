import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { getDb, closeDb, dbPath } from './db/index.js'
import { registrarHandlers } from './ipc/handlers.js'

const esDev = !app.isPackaged

let ventana = null

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    // Debe coincidir con el lienzo de la UI: evita el destello oscuro al abrir.
    backgroundColor: '#F6F7F9',
    autoHideMenuBar: true,
    title: 'Parqueadero Los Salazares',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  ventana.on('ready-to-show', () => {
    ventana.show()
    if (esDev) ventana.webContents.openDevTools({ mode: 'detach' })
  })

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (esDev && process.env.ELECTRON_RENDERER_URL) {
    ventana.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    ventana.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  getDb() // crea/abre la base de datos y aplica el esquema
  console.log('[db]', dbPath())

  registrarHandlers()
  crearVentana()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeDb()
})
