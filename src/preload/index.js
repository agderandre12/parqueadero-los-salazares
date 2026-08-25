import { contextBridge, ipcRenderer } from 'electron'

const invocar = (canal, ...args) => ipcRenderer.invoke(canal, ...args)

/** API expuesta al renderer como window.api */
const api = {
  settings: {
    get: () => invocar('settings:get'),
    update: (patch) => invocar('settings:update', patch)
  },
  dashboard: {
    resumen: () => invocar('dashboard:resumen')
  },
  vehiculos: {
    crear: (datos) => invocar('vehicles:crear', datos),
    activos: () => invocar('vehicles:activos'),
    ultimos: (limite) => invocar('vehicles:ultimos', limite),
    buscar: (texto) => invocar('vehicles:buscar', texto),
    historial: (filtros) => invocar('vehicles:historial', filtros),
    ficha: (placa) => invocar('vehicles:ficha', placa),
    celdaLibre: () => invocar('vehicles:celdaLibre'),
    cotizar: (params) => invocar('vehicles:cotizar', params),
    liquidar: (params) => invocar('vehicles:liquidar', params)
  },
  transacciones: {
    hoy: (fecha) => invocar('transactions:hoy', fecha),
    ultimas: (limite) => invocar('transactions:ultimas', limite)
  },
  metricas: {
    ventas: () => invocar('metricas:ventas')
  },
  caja: {
    resumen: (fecha) => invocar('caja:resumen', fecha),
    abrir: (params) => invocar('caja:abrir', params),
    cerrar: (params) => invocar('caja:cerrar', params),
    reabrir: (fecha) => invocar('caja:reabrir', fecha),
    cierres: (limite) => invocar('caja:cierres', limite)
  },
  impresora: {
    estado: () => invocar('printer:estado'),
    prueba: () => invocar('printer:prueba'),
    tiquete: (vehicleId) => invocar('printer:tiquete', vehicleId),
    reimprimir: (id) => invocar('printer:reimprimir', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
