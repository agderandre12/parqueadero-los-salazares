/**
 * Prueba de integración del flujo de entrada -> liquidación.
 * Corre sobre Electron con una base de datos temporal real (node:sqlite).
 *
 *   npm test
 */
import { app } from 'electron'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { DatabaseSync } from 'node:sqlite'

import { getDb, closeDb } from '../src/main/db/index.js'
import * as vehiculos from '../src/main/db/vehiclesRepo.js'
import * as transacciones from '../src/main/db/transactionsRepo.js'
import * as lavaderoRepo from '../src/main/db/lavaderoRepo.js'
import { getSettings, updateSettings } from '../src/main/db/settingsRepo.js'
import { cotizar, liquidar } from '../src/main/services/liquidacion.js'
import {
  codigoLavado,
  componerRecibo,
  componerReciboLavado,
  componerTiquete,
  componerTiqueteLavado,
  generarBytes,
  imprimirTiquete,
  plegar
} from '../src/main/services/printer.js'
import { nombreCola } from '../src/main/services/colaWindows.js'
import { registrarEntrada, cobroMensualidad } from '../src/main/services/entrada.js'
import { actualizarConfiguracion } from '../src/main/services/configuracion.js'
import {
  calcularCobro,
  normalizarTramos,
  simularTarifaHora
} from '../src/main/services/pricing.js'
import {
  entregarLavado,
  guardarTipo,
  ingresarLavado,
  retirarTipo
} from '../src/main/services/lavadero.js'
import {
  abrirCaja,
  cerrarCaja,
  reabrirCaja,
  resumenCaja,
  metricasVentas
} from '../src/main/services/caja.js'
import { aTextoSql, hoySql } from '../src/main/services/tiempo.js'

// Base de datos desechable: no toca los datos del parqueadero.
// Se fija antes de la primera llamada a getDb(), que es quien resuelve la ruta.
const carpetaTemporal = mkdtempSync(join(tmpdir(), 'parqueadero-test-'))
app.setPath('userData', carpetaTemporal)

let pasadas = 0
let fallidas = 0

const ok = (condicion, nombre, detalle = '') => {
  if (condicion) {
    pasadas++
    console.log(`  PASA  ${nombre}`)
  } else {
    fallidas++
    console.log(`  FALLA ${nombre}${detalle ? ` -> ${detalle}` : ''}`)
  }
}

const iguales = (real, esperado, nombre) =>
  ok(real === esperado, nombre, `esperado ${esperado}, recibido ${real}`)

const lanza = (fn, nombre) => {
  try {
    fn()
    ok(false, nombre, 'no lanzó error')
  } catch {
    ok(true, nombre)
  }
}

const lanzaAsync = async (fn, nombre) => {
  let error = null
  await fn().catch((e) => (error = e))
  ok(error !== null, nombre, 'no lanzó error')
}

// Tablas como las dejaron versiones viejas, sin ninguna columna agregada
// después: settings, vehicles y transactions de la primera versión (4d694db) y
// caja_dias del módulo de caja (9d348ca). Abrirlas con la versión actual prueba
// todas las migraciones juntas.
const ESQUEMA_VIEJO = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nombre_parqueadero TEXT NOT NULL DEFAULT 'Parqueadero Los Salazares',
    nit TEXT NOT NULL DEFAULT '', direccion TEXT NOT NULL DEFAULT '', telefono TEXT NOT NULL DEFAULT '',
    total_celdas INTEGER NOT NULL DEFAULT 50,
    tarifa_hora INTEGER NOT NULL DEFAULT 1500, tarifa_amanecida INTEGER NOT NULL DEFAULT 8000,
    tarifa_mensualidad INTEGER NOT NULL DEFAULT 60000, cargo_ticket_perdido INTEGER NOT NULL DEFAULT 2000,
    minutos_gracia INTEGER NOT NULL DEFAULT 10, horas_tope_dia INTEGER NOT NULL DEFAULT 24,
    impresora_tipo TEXT NOT NULL DEFAULT 'EPSON', impresora_interface TEXT NOT NULL DEFAULT '',
    impresora_ancho INTEGER NOT NULL DEFAULT 32, imprimir_automatico INTEGER NOT NULL DEFAULT 1,
    mensaje_recibo TEXT NOT NULL DEFAULT 'Gracias por preferirnos',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, placa TEXT NOT NULL,
    marca TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', casco INTEGER NOT NULL DEFAULT 0,
    celda INTEGER, hora_entrada TEXT NOT NULL DEFAULT (datetime('now','localtime')), hora_salida TEXT,
    tipo_tarifa TEXT NOT NULL DEFAULT 'hora', tarifa_personalizada INTEGER,
    estado TEXT NOT NULL DEFAULT 'activo', observaciones TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, placa TEXT NOT NULL,
    monto_base INTEGER NOT NULL DEFAULT 0, recargo INTEGER NOT NULL DEFAULT 0, monto INTEGER NOT NULL,
    minutos INTEGER NOT NULL DEFAULT 0, tipo_tarifa TEXT NOT NULL DEFAULT 'hora',
    tipo TEXT NOT NULL DEFAULT 'normal', fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    impreso INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE caja_dias (
    fecha TEXT PRIMARY KEY, base_inicial INTEGER NOT NULL DEFAULT 0,
    abierta_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), cerrada_at TEXT,
    conteo_final INTEGER, diferencia INTEGER, observaciones TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO caja_dias (fecha, base_inicial, cerrada_at, conteo_final, diferencia)
    VALUES ('2025-03-10', 0, '2025-03-10 21:00:00', 5400, 0);
  INSERT INTO settings (id, tarifa_hora) VALUES (1, 1800);
  INSERT INTO vehicles (placa, celda, hora_entrada, hora_salida, estado)
    VALUES ('VIE01A', 4, '2025-03-10 08:00:00', '2025-03-10 10:30:00', 'finalizado');
  INSERT INTO transactions (vehicle_id, placa, monto_base, monto, minutos, fecha)
    VALUES (1, 'VIE01A', 5400, 5400, 150, '2025-03-10 10:30:00');
`

/**
 * Entrada con hora de ingreso desplazada N horas hacia atrás.
 * Se descuentan 30 s para que, al cobrarse por hora iniciada, el tiempo
 * transcurrido durante la prueba no empuje el cálculo a la hora siguiente.
 */
const entradaHace = (placa, horas, extra = {}) => {
  const desfase = horas > 0 ? horas * 3600000 - 30000 : 0
  return vehiculos.crearEntrada({
    placa,
    marca: 'Bajaj',
    color: 'Negro',
    hora_entrada: aTextoSql(new Date(Date.now() - desfase)),
    ...extra
  })
}

async function correr() {
  getDb()
  const settings = getSettings()

  console.log('\nEntradas y celdas')
  const v1 = entradaHace('ABC12D', 3)
  iguales(v1.celda, 1, 'la primera entrada toma la celda 01')
  iguales(v1.estado, 'activo', 'queda en estado activo')

  const v2 = entradaHace('XYZ99Z', 1)
  iguales(v2.celda, 2, 'la segunda entrada toma la celda 02')

  lanza(() => entradaHace('abc-12d', 1), 'rechaza la misma placa dos veces adentro')

  const stats1 = vehiculos.estadisticasHoy()
  iguales(stats1.ocupadas, 2, 'ocupadas = 2')
  iguales(stats1.disponibles, settings.total_celdas - 2, 'disponibles descuenta las ocupadas')
  iguales(stats1.entradasHoy, 2, 'entradas de hoy = 2')

  const { celdas } = vehiculos.mapaCeldas()
  iguales(celdas.length, settings.total_celdas, 'la cuadrícula trae 50 celdas')
  iguales(celdas[0].placa, 'ABC12D', 'la celda 01 muestra su placa')
  iguales(celdas[2].ocupada, false, 'la celda 03 está libre')

  console.log('\nCotización')
  const cot = cotizar({ placa: 'ABC12D' })
  iguales(cot.cobro.total, 3 * settings.tarifa_hora, '3 horas = 3 x tarifa hora')
  iguales(cot.cobro.recargo, 0, 'sin recargo en cotización normal')

  const cotTP = cotizar({ placa: 'ABC12D', ticketPerdido: true })
  iguales(cotTP.cobro.recargo, settings.cargo_ticket_perdido, 'ticket perdido suma el recargo')
  iguales(
    cotTP.cobro.total,
    cot.cobro.total + settings.cargo_ticket_perdido,
    'total con ticket perdido = tiempo + 2.000'
  )
  lanza(() => cotizar({ placa: 'NOEXISTE' }), 'cotizar placa inexistente falla')

  console.log('\nLiquidación normal')
  let sinMetodo = null
  await liquidar({ vehicleId: v1.id }).catch((e) => (sinMetodo = e))
  ok(sinMetodo !== null, 'el método de pago es obligatorio')
  iguales(
    vehiculos.obtenerPorId(v1.id).estado,
    'activo',
    'el vehículo sigue adentro si la liquidación se rechazó'
  )

  const res = await liquidar({ vehicleId: v1.id, metodoPago: 'efectivo' })
  iguales(res.vehicle.estado, 'finalizado', 'el vehículo queda finalizado')
  ok(Boolean(res.vehicle.hora_salida), 'guarda la hora de salida')
  iguales(res.transaccion.tipo, 'normal', 'la transacción es de tipo normal')
  iguales(res.transaccion.metodo_pago, 'efectivo', 'guarda el método de pago')
  iguales(res.transaccion.monto, 3 * settings.tarifa_hora, 'monto cobrado correcto')
  iguales(res.transaccion.monto_base + res.transaccion.recargo, res.transaccion.monto, 'base + recargo = total')
  iguales(res.impresion.ok, false, 'la impresión reporta pendiente sin romper el cobro')

  const mapa2 = vehiculos.mapaCeldas()
  iguales(mapa2.celdas[0].ocupada, false, 'la celda 01 quedó libre')

  const stats2 = vehiculos.estadisticasHoy()
  iguales(stats2.ocupadas, 1, 'ocupadas baja a 1')
  iguales(stats2.salidasHoy, 1, 'salidas de hoy = 1')
  iguales(stats2.recaudoHoy, 3 * settings.tarifa_hora, 'el recaudo del día suma el cobro')

  console.log('\nDoble cobro y reingreso')
  let doble = null
  await liquidar({ vehicleId: v1.id, metodoPago: 'efectivo' }).catch((e) => (doble = e))
  ok(doble !== null, 'no permite liquidar dos veces el mismo ingreso')

  const v3 = entradaHace('ABC12D', 0)
  iguales(v3.celda, 1, 'la placa puede reingresar y reutiliza la celda 01')

  console.log('\nTicket perdido')
  const resTP = await liquidar({ vehicleId: v2.id, ticketPerdido: true, metodoPago: 'transferencia' })
  iguales(resTP.transaccion.tipo, 'ticket_perdido', 'la transacción se marca como ticket_perdido')
  iguales(resTP.transaccion.recargo, settings.cargo_ticket_perdido, 'registra el recargo de 2.000')
  iguales(
    resTP.transaccion.monto,
    settings.tarifa_hora + settings.cargo_ticket_perdido,
    '1 hora + recargo'
  )

  console.log('\nMensualidad: se cobra al entrar')
  const transaccionesAntes = transacciones.ultimasTransacciones(100).length

  let sinMetodoMes = null
  await registrarEntrada({ placa: 'MEN002', tipo_tarifa: 'mensualidad' }).catch(
    (e) => (sinMetodoMes = e)
  )
  ok(sinMetodoMes !== null, 'la mensualidad exige método de pago')
  ok(!vehiculos.buscarActivoPorPlaca('MEN002'), 'sin método de pago la moto no queda adentro')

  // Comprobante obligatorio: se intenta imprimir aunque la impresión automática esté apagada.
  updateSettings({ imprimir_automatico: 0 })
  const mes = await registrarEntrada({
    placa: 'MEN001',
    tipo_tarifa: 'mensualidad',
    metodoPago: 'transferencia',
    hora_entrada: aTextoSql(new Date(Date.now() - 5 * 3600000))
  })
  updateSettings({ imprimir_automatico: 1 })
  iguales(mes.vehicle.estado, 'activo', 'la moto de mensualidad queda adentro')
  iguales(mes.transaccion.monto, settings.tarifa_mensualidad, 'la venta es la tarifa de mensualidad')
  iguales(mes.transaccion.metodo_pago, 'transferencia', 'con el método de pago escogido')
  iguales(mes.transaccion.tipo_tarifa, 'mensualidad', 'marcada como mensualidad')
  iguales(mes.transaccion.fecha, mes.vehicle.hora_entrada, 'con la fecha de la entrada')
  iguales(
    mes.impresion.motivo,
    'Impresora no configurada',
    'el comprobante se intenta imprimir aunque la impresión automática esté apagada'
  )

  let dobleMes = null
  await registrarEntrada({ placa: 'MEN001', tipo_tarifa: 'mensualidad', metodoPago: 'efectivo' }).catch(
    (e) => (dobleMes = e)
  )
  ok(dobleMes !== null, 'no deja entrar dos veces la misma placa de mensualidad')
  iguales(
    transacciones.ultimasTransacciones(100).length,
    transaccionesAntes + 1,
    'una entrada rechazada no deja venta (operación atómica)'
  )

  const cotMes = cotizar({ placa: 'MEN001', ticketPerdido: true })
  iguales(cotMes.cobro.total, 0, 'a la salida no se cobra nada, ni el tiquete perdido')
  const salidaMes = await liquidar({ vehicleId: mes.vehicle.id })
  iguales(salidaMes.vehicle.estado, 'finalizado', 'la salida no pide método de pago')
  iguales(salidaMes.transaccion, null, 'la salida no registra otra venta')
  iguales(
    transacciones.ultimasTransacciones(100).length,
    transaccionesAntes + 1,
    'la mensualidad deja una sola venta'
  )

  const hora1 = await registrarEntrada({
    placa: 'HOR001',
    hora_entrada: aTextoSql(new Date(Date.now() - 2 * 3600000))
  })
  iguales(hora1.transaccion, null, 'una entrada por hora no cobra al entrar')

  console.log('\nOtras tarifas')
  const vPers = entradaHace('PER001', 5, { tipo_tarifa: 'personalizada', tarifa_personalizada: 5000 })
  iguales(
    (await liquidar({ vehicleId: vPers.id, metodoPago: 'efectivo' })).transaccion.monto,
    5000,
    'tarifa personalizada cobra lo pactado'
  )

  const vTope = entradaHace('TOP001', 10)
  iguales(
    cotizar({ placa: 'TOP001' }).cobro.total,
    settings.tarifa_amanecida,
    '10 horas se topan en la tarifa de amanecida'
  )
  await liquidar({ vehicleId: vTope.id, metodoPago: 'efectivo' })

  console.log('\nMétodos de pago y métricas')
  const efectivoEsperado = 3 * settings.tarifa_hora + 5000 + settings.tarifa_amanecida
  const transferenciaEsperada =
    settings.tarifa_hora + settings.cargo_ticket_perdido + settings.tarifa_mensualidad

  const ventas = metricasVentas()
  iguales(ventas.dia.efectivo, efectivoEsperado, 'las ventas del día suman sólo el efectivo')
  iguales(
    ventas.dia.transferencia,
    transferenciaEsperada,
    'las transferencias se contabilizan aparte'
  )
  iguales(
    ventas.dia.total,
    efectivoEsperado + transferenciaEsperada,
    'el total del día suma ambos métodos'
  )
  iguales(ventas.semana.total, ventas.dia.total, 'la semana en curso incluye el día')
  iguales(ventas.mes.total, ventas.dia.total, 'el mes en curso incluye el día')

  console.log('\nCaja registradora')
  const sinBase = resumenCaja()
  iguales(sinBase.fecha, hoySql(), 'la jornada se abre sola con la fecha de hoy')
  iguales(sinBase.baseInicial, 0, 'sin base configurada, la jornada arranca en cero')
  iguales(sinBase.esperado, efectivoEsperado, 'sin base, el cajón sólo tiene el efectivo cobrado')

  const conBase = abrirCaja({ baseInicial: 50000 })
  iguales(conBase.baseInicial, 50000, 'la base de dinero queda guardada')
  iguales(
    conBase.esperado,
    50000 + efectivoEsperado,
    'el saldo esperado es base + efectivo, sin las transferencias'
  )
  ok(
    conBase.esperado !== 50000 + conBase.totalVentas,
    'la transferencia NO incrementa el saldo físico de la caja'
  )

  const cuadrada = cerrarCaja({ conteoFinal: 50000 + efectivoEsperado })
  iguales(cuadrada.diferencia, 0, 'contar lo esperado cierra la caja sin diferencia')
  iguales(cuadrada.cerrada, true, 'la jornada queda cerrada')
  lanza(() => cerrarCaja({ conteoFinal: 1000 }), 'no se puede cerrar dos veces el mismo día')

  reabrirCaja()
  const faltante = cerrarCaja({ conteoFinal: 50000 + efectivoEsperado - 7500 })
  iguales(faltante.diferencia, -7500, 'el faltante se guarda con signo negativo')

  console.log('\nCaja: de un día al siguiente')
  // Jornadas de enero, lejos de la de hoy: el cierre de una noche tiene que ser
  // la apertura de la mañana siguiente.
  const motoCaja = vehiculos.crearEntrada({ placa: 'CAJ001', hora_entrada: '2026-01-10 09:00:00' })
  vehiculos.finalizar(motoCaja.id, '2026-01-10 15:00:00')
  transacciones.registrarTransaccion({
    vehicle_id: motoCaja.id,
    placa: 'CAJ001',
    monto_base: 20000,
    metodo_pago: 'efectivo',
    fecha: '2026-01-10 15:00:00'
  })
  abrirCaja({ fecha: '2026-01-10', baseInicial: 50000 })
  const cierreNoche = cerrarCaja({ fecha: '2026-01-10', conteoFinal: 70000 })
  iguales(cierreNoche.diferencia, 0, 'la noche cierra cuadrada: 50.000 de base + 20.000 en efectivo')
  const manana = resumenCaja('2026-01-11')
  iguales(manana.baseInicial, 70000, 'a la mañana siguiente la caja abre con lo que quedó en el cajón')
  iguales(manana.esperado, 70000, 'y eso es lo que debe haber antes del primer cobro')
  ok(
    manana.anterior?.fecha === '2026-01-10' && manana.anterior.cerrada,
    'y sabe de qué cierre viene'
  )

  // Segunda noche: se retira la plata y se deja sólo una base para mañana.
  transacciones.registrarTransaccion({
    vehicle_id: motoCaja.id,
    placa: 'CAJ001',
    monto_base: 15000,
    metodo_pago: 'efectivo',
    fecha: '2026-01-11 12:00:00'
  })
  transacciones.registrarTransaccion({
    vehicle_id: motoCaja.id,
    placa: 'CAJ001',
    monto_base: 8000,
    metodo_pago: 'transferencia',
    fecha: '2026-01-11 13:00:00'
  })
  const antesDeCerrar = resumenCaja('2026-01-11')
  ok(
    antesDeCerrar.operaciones === 2 && antesDeCerrar.cobrosEfectivo === 1,
    'de los 2 cobros del día sólo 1 entró al cajón',
    `${antesDeCerrar.cobrosEfectivo} de ${antesDeCerrar.operaciones}`
  )
  lanza(
    () => cerrarCaja({ fecha: '2026-01-11', conteoFinal: 85000, quedaEnCaja: 90000 }),
    'no puede quedar en el cajón más de lo que se contó'
  )
  const conRetiro = cerrarCaja({ fecha: '2026-01-11', conteoFinal: 85000, quedaEnCaja: 30000 })
  iguales(conRetiro.diferencia, 0, 'la segunda noche también cuadra: 70.000 + 15.000')
  iguales(conRetiro.quedaEnCaja, 30000, 'y se dejan 30.000 al retirar el resto')
  iguales(
    resumenCaja('2026-01-12').baseInicial,
    30000,
    'el día siguiente abre con lo que se dejó, no con lo contado'
  )

  // Una noche sin cerrar: la mañana no puede adivinar cuánto quedó.
  updateSettings({ caja_base_predeterminada: 25000 })
  const sinCierre = resumenCaja('2026-01-13')
  iguales(sinCierre.baseInicial, 25000, 'si la jornada anterior quedó abierta, abre con la base predeterminada')
  ok(
    sinCierre.anterior?.fecha === '2026-01-12' && !sinCierre.anterior.cerrada,
    'y avisa que la anterior sigue abierta'
  )
  const cierreTardio = cerrarCaja({ fecha: '2026-01-12', conteoFinal: 30000 })
  iguales(cierreTardio.cerrada, true, 'la jornada anterior se puede cerrar después (pasada la medianoche)')
  iguales(cierreTardio.quedaEnCaja, 30000, 'sin indicar cuánto queda, queda todo lo contado')
  iguales(
    resumenCaja('2026-01-13').anterior.quedaEnCaja,
    30000,
    'y la jornada siguiente ve lo que quedó, para tomarlo como base'
  )
  iguales(reabrirCaja('2026-01-12').quedaEnCaja, null, 'reabrir borra lo que se había dejado')
  updateSettings({ caja_base_predeterminada: 0 })

  console.log('\nHistorial')
  const hoy = transacciones.transaccionesDelDia()
  iguales(hoy.length, 5, 'quedaron 5 transacciones del día')
  iguales(
    vehiculos.ultimosIngresos(7)[0].placa,
    'ABC12D',
    'los últimos ingresos vienen del más reciente al más antiguo'
  )

  console.log('\nTiquete y recibo')
  const ajustes = getSettings()
  ok(
    ajustes.politicas_tiquete.includes('Cascos en custodia'),
    'una base nueva trae las políticas del tiquete'
  )
  ok(
    ajustes.politicas_tiquete.includes('{ticket_perdido}'),
    'las políticas guardan el marcador del recargo, no un valor fijo'
  )
  ok(
    Boolean(ajustes.direccion && ajustes.telefono && ajustes.horario),
    'una base nueva trae dirección, teléfono y horario'
  )

  // Los bytes ESC/POS se leen como latin1: los textos sin tildes se ven tal cual.
  const bytes = (componer) => generarBytes(ajustes, componer).then((b) => b.toString('latin1'))
  const comando = (...b) => Buffer.from(b).toString('latin1')

  const tiquete = await bytes((p) => componerTiquete(p, { settings: ajustes, vehicle: v3 }))
  ok(tiquete.includes('TIQUETE DE ENTRADA'), 'el tiquete se arma sin impresora conectada')
  ok(tiquete.includes(v3.placa), 'lleva la placa')
  ok(tiquete.includes(ajustes.telefono), 'lleva el teléfono del negocio')
  ok(tiquete.includes('Cisneros'), 'lleva la dirección del negocio')
  ok(tiquete.includes('Entrada:'), 'lleva la hora de entrada')
  ok(tiquete.includes('$2.000'), 'las políticas muestran el recargo vigente')
  ok(!tiquete.includes('{ticket_perdido}'), 'no queda el marcador sin reemplazar')
  ok(
    tiquete.includes(comando(0x1d, 0x6b, 73, v3.placa.length + 2) + `{B${v3.placa}`),
    'el código de barras es Code 128 con la placa'
  )
  ok(tiquete.includes(comando(0x1d, 0x68, 140)), 'las barras miden 140 puntos de alto')
  ok(
    tiquete.includes(comando(0x1d, 0x77, 3)),
    'placa de 6 caracteres en 58 mm: módulo de 3 puntos'
  )

  const largo = await bytes((p) =>
    componerTiquete(p, { settings: ajustes, vehicle: { ...v3, placa: 'ABC123D' } })
  )
  ok(
    largo.includes(comando(0x1d, 0x77, 2)),
    'placa de 7 caracteres: módulo de 2 para que quepa con margen'
  )

  const lineas = plegar(ajustes.politicas_tiquete, 32)
  ok(
    lineas.every((l) => l.length <= 32),
    'las políticas se parten en renglones de 32 caracteres'
  )
  iguales(
    lineas.join(' ').split(/\s+/).length,
    ajustes.politicas_tiquete.split(/\s+/).length,
    'partir renglones no pierde palabras'
  )
  iguales(plegar('ABCDEFGHIJ', 4).join('|'), 'ABCD|EFGH|IJ', 'una palabra más larga que el renglón se parte')

  const recibo = await bytes((p) =>
    componerRecibo(p, {
      settings: ajustes,
      vehicle: res.vehicle,
      cobro: res.cobro,
      transaccion: res.transaccion
    })
  )
  ok(recibo.includes('Salida:'), 'el recibo lleva la hora de salida')
  ok(recibo.includes('RECIBO No. 000001'), 'el recibo lleva su número')
  ok(recibo.includes('EFECTIVO'), 'el recibo lleva el método de pago')

  const comprobante = await bytes((p) =>
    componerRecibo(p, {
      settings: ajustes,
      vehicle: mes.vehicle,
      transaccion: mes.transaccion,
      cobro: cobroMensualidad(mes.transaccion)
    })
  )
  ok(comprobante.includes(`RECIBO No. ${String(mes.transaccion.id).padStart(6, '0')}`), 'el comprobante de mensualidad lleva su número')
  ok(comprobante.includes('Mensualidad') && comprobante.includes('$60.000'), 'y el valor de la mensualidad')
  ok(
    !comprobante.includes('Salida:') && !comprobante.includes('Pago:') && !comprobante.includes('TRANSFERENCIA'),
    'sin hora de salida ni método de pago'
  )
  ok(!comprobante.includes(comando(0x1d, 0x6b)), 'sin código de barras')

  updateSettings({ politicas_tiquete: '' })
  const sinPoliticas = await bytes((p) =>
    componerTiquete(p, { settings: getSettings(), vehicle: v3 })
  )
  ok(!sinPoliticas.includes('Cascos'), 'con las políticas vacías el tiquete sale sin ellas')
  closeDb()
  getDb()
  iguales(getSettings().politicas_tiquete, '', 'borrar las políticas no las vuelve a sembrar')

  console.log('\nEnvío a la impresora')
  iguales(nombreCola(' printer:JAL58M '), 'JAL58M', 'acepta el nombre con el prefijo printer:')
  iguales(nombreCola('POS-58'), 'POS-58', 'y sin el prefijo')
  if (process.platform === 'win32') {
    const fallo = await imprimirTiquete({
      settings: { ...ajustes, impresora_interface: 'printer:NoExiste Parqueadero Prueba' },
      vehicle: v3
    })
    iguales(fallo.ok, false, 'imprimir en una impresora inexistente no lanza')
    ok(/No existe una impresora/.test(fallo.motivo || ''), 'y explica qué pasó', fallo.motivo)
  }

  console.log('\nCobrar con o sin imprimir')
  // Sin impresora configurada: si se intenta imprimir, el motivo lo delata.
  const sinPapel = await liquidar({
    vehicleId: entradaHace('SIN001', 2).id,
    metodoPago: 'efectivo',
    imprimir: false
  })
  iguales(
    sinPapel.impresion.motivo,
    'Cobrado sin imprimir',
    '"Cobrar sin imprimir" no imprime aunque la impresión automática esté encendida'
  )
  iguales(sinPapel.transaccion.impreso, 0, 'y el recibo queda marcado como no impreso')

  updateSettings({ imprimir_automatico: 0 })
  const conPapel = await liquidar({
    vehicleId: entradaHace('CON001', 2).id,
    metodoPago: 'efectivo',
    imprimir: true
  })
  iguales(
    conPapel.impresion.motivo,
    'Impresora no configurada',
    '"Cobrar e imprimir" intenta imprimir aunque la automática esté apagada'
  )
  const porDefecto = await liquidar({ vehicleId: entradaHace('DEF001', 2).id, metodoPago: 'efectivo' })
  iguales(
    porDefecto.impresion.motivo,
    'Impresión automática desactivada',
    'sin botón explícito decide la configuración'
  )
  updateSettings({ imprimir_automatico: 1 })

  console.log('\nValor acordado al cobrar')
  const ventasAntesAcuerdo = metricasVentas().dia.total
  const vDescuento = entradaHace('DES001', 3)
  await lanzaAsync(
    () => liquidar({ vehicleId: vDescuento.id, metodoPago: 'efectivo', totalAcordado: -100 }),
    'un valor acordado negativo se rechaza'
  )
  await lanzaAsync(
    () => liquidar({ vehicleId: vDescuento.id, metodoPago: 'efectivo', totalAcordado: 'mucho' }),
    'un valor acordado que no es número se rechaza'
  )
  iguales(vehiculos.obtenerPorId(vDescuento.id).estado, 'activo', 'y la moto sigue adentro')

  const conDescuento = await liquidar({
    vehicleId: vDescuento.id,
    metodoPago: 'efectivo',
    totalAcordado: 3000,
    imprimir: false
  })
  iguales(conDescuento.transaccion.monto, 3000, 'se cobra el valor acordado')
  iguales(conDescuento.transaccion.monto_base, 3 * settings.tarifa_hora, 'el cobro calculado se conserva')
  iguales(
    conDescuento.transaccion.ajuste,
    3000 - 3 * settings.tarifa_hora,
    'la diferencia queda como ajuste (negativo = descuento)'
  )
  iguales(
    conDescuento.transaccion.monto_base + conDescuento.transaccion.recargo + conDescuento.transaccion.ajuste,
    conDescuento.transaccion.monto,
    'base + recargo + ajuste = total'
  )
  iguales(metricasVentas().dia.total, ventasAntesAcuerdo + 3000, 'las ventas suman lo que pagó el cliente')

  const gratis = await liquidar({
    vehicleId: entradaHace('GRA001', 1).id,
    metodoPago: 'efectivo',
    totalAcordado: 0,
    imprimir: false
  })
  iguales(gratis.transaccion.monto, 0, 'se puede acordar no cobrar nada')

  const reciboDescuento = await bytes((p) =>
    componerRecibo(p, {
      settings: ajustes,
      vehicle: conDescuento.vehicle,
      cobro: conDescuento.cobro,
      transaccion: conDescuento.transaccion
    })
  )
  ok(reciboDescuento.includes('Descuento acordado'), 'el recibo muestra el descuento')
  ok(reciboDescuento.includes('-$1.500'), 'con su valor')
  ok(reciboDescuento.includes('$3.000'), 'y el total cobrado')

  console.log('\nReglas por tiempo')
  const tramosValidos = normalizarTramos([
    { desde: '12', hasta: '24', valor: '15000' },
    { desde: 5, hasta: 12, valor: 10000 }
  ])
  iguales(tramosValidos[0].desde, 5, 'las reglas se ordenan por la hora de inicio')
  iguales(tramosValidos[1].valor, 15000, 'y sus valores pasan a número')
  lanza(
    () => normalizarTramos([{ desde: 5, hasta: 12, valor: 1 }, { desde: 10, hasta: 14, valor: 1 }]),
    'dos reglas que se cruzan se rechazan'
  )
  lanza(() => normalizarTramos([{ desde: 8, hasta: 8, valor: 1 }]), 'una regla sin duración se rechaza')
  lanza(() => normalizarTramos([{ desde: '', hasta: 8, valor: 1 }]), 'una regla sin horas se rechaza')
  lanza(() => normalizarTramos([{ desde: 1, hasta: 8, valor: '' }]), 'una regla sin valor se rechaza')

  actualizarConfiguracion({
    tarifa_hora: 2000,
    tarifa_amanecida: 15000,
    tramos_hora: JSON.stringify([{ desde: 5, hasta: 12, valor: 10000 }])
  })
  lanza(
    () => actualizarConfiguracion({ tramos_hora: [{ desde: 3, hasta: 1, valor: 0 }] }),
    'no se guarda una configuración con reglas inválidas'
  )
  iguales(
    getSettings().tramos_hora,
    '[{"desde":5,"hasta":12,"valor":10000}]',
    'y la regla guardada sigue igual'
  )

  const cobroDe = (placa, horas) => {
    entradaHace(placa, horas)
    return cotizar({ placa }).cobro
  }
  iguales(cobroDe('TRA004', 4).total, 8000, '4 h se cobran por hora (4 x 2.000)')
  iguales(cobroDe('TRA005', 5).total, 10000, '5 h todavía se cobran por hora')
  const enTramo = cobroDe('TRA007', 7)
  iguales(enTramo.total, 10000, 'más de 5 h y hasta 12 h: valor fijo de 10.000')
  ok(Boolean(enTramo.tramo) && enTramo.detalle.includes('tramo'), 'y el detalle nombra el tramo')
  iguales(cobroDe('TRA012', 12).total, 10000, '12 h siguen en el tramo')
  const trasTramo = cobroDe('TRA013', 13)
  iguales(trasTramo.total, 15000, 'después del tramo vuelve por hora, con el tope de la amanecida')
  ok(trasTramo.tope, 'y se marca el tope')

  const simulacion = simularTarifaHora(getSettings())
  iguales(simulacion.length, 24, 'la simulación cubre el primer bloque de 24 h')
  ok(simulacion[5].tramo && simulacion[5].total === 10000, 'la simulación marca el tramo en la hora 6')
  ok(simulacion[12].tope, 'y el tope en la hora 13')
  lanza(
    () => simularTarifaHora({ ...getSettings(), tramos_hora: '[{"desde":4,"hasta":2,"valor":0}]' }),
    'la simulación avisa de una regla inválida antes de guardarla'
  )
  actualizarConfiguracion({ tarifa_hora: 1500, tarifa_amanecida: 8000, tramos_hora: '[]' })

  console.log('\nValidación de la configuración')
  lanza(() => actualizarConfiguracion({ tarifa_hora: '' }), 'un precio vacío no se guarda')
  lanza(() => actualizarConfiguracion({ tarifa_hora: -1 }), 'un precio negativo no se guarda')
  lanza(() => actualizarConfiguracion({ total_celdas: 0 }), 'cero celdas no se guarda')
  lanza(() => actualizarConfiguracion({ impresora_ancho: 40 }), 'un ancho de papel raro no se guarda')
  iguales(getSettings().tarifa_hora, 1500, 'el precio sigue intacto tras un intento inválido')
  iguales(actualizarConfiguracion({ tarifa_hora: '2500' }).tarifa_hora, 2500, 'un precio en texto se guarda como número')
  iguales(actualizarConfiguracion({ imprimir_automatico: true }).imprimir_automatico, 1, 'las casillas se guardan como 0/1')
  actualizarConfiguracion({ tarifa_hora: 1500 })

  console.log('\nCasco y locker')
  const conCasco = vehiculos.crearEntrada({ placa: 'CAS001', casco: true, locker: ' qz9 ' })
  iguales(conCasco.locker, 'QZ9', 'el locker se guarda en mayúsculas y sin espacios')
  const sinCasco = vehiculos.crearEntrada({ placa: 'CAS002', casco: false, locker: '9' })
  iguales(sinCasco.locker, '', 'sin casco en custodia no se guarda locker')

  const tiqueteCasco = await bytes((p) => componerTiquete(p, { settings: getSettings(), vehicle: conCasco }))
  ok(
    !tiqueteCasco.includes('Casco:') && !tiqueteCasco.includes('En custodia') && !tiqueteCasco.includes('QZ9'),
    'el tiquete no dice si dejó el casco ni dónde'
  )
  const salidaCasco = await liquidar({ vehicleId: conCasco.id, metodoPago: 'efectivo', imprimir: false })
  const reciboCasco = await bytes((p) =>
    componerRecibo(p, {
      settings: getSettings(),
      vehicle: salidaCasco.vehicle,
      cobro: salidaCasco.cobro,
      transaccion: salidaCasco.transaccion
    })
  )
  ok(!reciboCasco.includes('Casco:') && !reciboCasco.includes('QZ9'), 'el recibo tampoco')

  console.log('\nLavadero: tipos de lavada')
  lanza(() => guardarTipo({ nombre: '  ', precio: 1000 }), 'una lavada necesita nombre')
  lanza(() => guardarTipo({ nombre: 'Sin precio', precio: '' }), 'y precio')
  const general = guardarTipo({ nombre: ' Lavada   general ', precio: 15000 })
  iguales(general.nombre, 'Lavada general', 'el nombre se guarda sin espacios de más')
  lanza(() => guardarTipo({ nombre: 'lavada GENERAL', precio: 1 }), 'no se repite un nombre')
  const full = guardarTipo({ nombre: 'Lavada full', precio: 25000 })
  iguales(guardarTipo({ id: full.id, nombre: 'Lavada full', precio: 28000 }).precio, 28000, 'el precio se puede corregir')
  iguales(lavaderoRepo.listarTipos().length, 2, 'el catálogo trae las dos lavadas')

  console.log('\nLavadero: ingreso')
  lanza(() => ingresarLavado({ placa: 'MOT01A' }), 'sin tipo de lavada no se ingresa')
  lanza(() => ingresarLavado({ tipoLavadaId: general.id }), 'sin placa no se ingresa')
  const lavado1 = ingresarLavado({
    placa: 'mot-01a',
    tipoLavadaId: general.id,
    marca: 'Yamaha',
    casco: true,
    locker: '3'
  })
  iguales(lavado1.placa, 'MOT01A', 'la placa se normaliza')
  iguales(lavado1.precio, 15000, 'se cobra el precio de la lavada')
  iguales(lavado1.pactado, 0, 'sin valor pactado')
  iguales(lavado1.locker, '3', 'con el locker del casco')
  iguales(lavado1.estado, 'activo', 'y queda en el lavadero')
  lanza(
    () => ingresarLavado({ placa: 'MOT01A', tipoLavadaId: general.id }),
    'la misma placa no entra dos veces al lavadero'
  )

  const lavado2 = ingresarLavado({ placa: 'MOT02B', tipoLavadaId: full.id, valorPactado: 12000 })
  iguales(lavado2.precio, 12000, 'el valor pactado reemplaza el precio')
  ok(lavado2.pactado === 1 && lavado2.precio_lista === 28000, 'y se guarda el precio de lista')

  guardarTipo({ id: general.id, nombre: 'Lavada general', precio: 18000 })
  iguales(lavaderoRepo.obtenerLavado(lavado1.id).precio, 15000, 'cambiar el catálogo no cambia una moto ya ingresada')

  retirarTipo(full.id)
  iguales(lavaderoRepo.listarTipos().length, 1, 'una lavada retirada sale del catálogo')
  lanza(() => ingresarLavado({ placa: 'MOT03C', tipoLavadaId: full.id }), 'y ya no se puede escoger')
  iguales(lavaderoRepo.obtenerLavado(lavado2.id).tipo_lavada, 'Lavada full', 'la moto que la tenía la conserva')

  const tiqueteLavado = await bytes((p) =>
    componerTiqueteLavado(p, { settings: getSettings(), lavado: lavado1 })
  )
  const codigo = codigoLavado(lavado1.id)
  ok(tiqueteLavado.includes('TIQUETE DE LAVADERO'), 'el tiquete de lavadero se arma sin impresora')
  ok(tiqueteLavado.includes('MOT01A') && tiqueteLavado.includes('Lavada general'), 'con la placa y la lavada')
  ok(tiqueteLavado.includes('$15.000'), 'y el valor')
  ok(
    tiqueteLavado.includes(comando(0x1d, 0x6b, 73, codigo.length + 2) + `{B${codigo}`),
    `el código de barras es ${codigo}, distinto de una placa`
  )
  ok(tiqueteLavado.includes(comando(0x1d, 0x77, 2)), 'nueve caracteres caben con módulo de 2 puntos')
  ok(!tiqueteLavado.includes('Casco') && !tiqueteLavado.includes('ocker'), 'sin el casco ni el locker')

  console.log('\nLavadero: entrega y cobro')
  const ventasAntesLavadero = metricasVentas().dia
  const cajaAntesLavadero = resumenCaja().esperado

  await lanzaAsync(() => entregarLavado({ id: lavado1.id }), 'entregar exige método de pago')
  iguales(lavaderoRepo.obtenerLavado(lavado1.id).estado, 'activo', 'y la moto sigue en el lavadero')

  const entrega1 = await entregarLavado({ id: lavado1.id, metodoPago: 'efectivo', imprimir: false })
  iguales(entrega1.lavado.estado, 'entregado', 'la lavada queda entregada')
  iguales(entrega1.lavado.monto, 15000, 'cobrada a su precio')
  iguales(entrega1.impresion.motivo, 'Cobrado sin imprimir', 'sin imprimir si así se pidió')
  await lanzaAsync(
    () => entregarLavado({ id: lavado1.id, metodoPago: 'efectivo' }),
    'no se cobra dos veces la misma lavada'
  )

  const entrega2 = await entregarLavado({
    id: lavado2.id,
    metodoPago: 'transferencia',
    totalAcordado: 10000,
    imprimir: true
  })
  iguales(entrega2.lavado.monto, 10000, 'el valor acordado al entregar es lo que se cobra')
  iguales(entrega2.lavado.ajuste, -2000, 'con su descuento')
  iguales(entrega2.impresion.motivo, 'Impresora no configurada', '"Cobrar e imprimir" intenta imprimir el recibo')

  const ventasConLavadero = metricasVentas().dia
  iguales(ventasConLavadero.lavadero, 25000, 'las ventas del día informan el lavadero aparte')
  iguales(ventasConLavadero.total, ventasAntesLavadero.total + 25000, 'y lo suman al total')
  iguales(ventasConLavadero.efectivo, ventasAntesLavadero.efectivo + 15000, 'el efectivo del lavadero entra en efectivo')
  iguales(
    ventasConLavadero.transferencia,
    ventasAntesLavadero.transferencia + 10000,
    'la transferencia del lavadero, en transferencias'
  )
  iguales(resumenCaja().esperado, cajaAntesLavadero + 15000, 'la caja espera el efectivo del lavadero')
  iguales(lavaderoRepo.lavadosEntregadosDelDia(hoySql()).length, 2, 'las dos aparecen como entregadas hoy')
  iguales(vehiculos.resumenPlaca('MOT01A').totalCobrado, 15000, 'la ficha de la placa suma lo del lavadero')

  const reciboLavado = await bytes((p) =>
    componerReciboLavado(p, { settings: getSettings(), lavado: entrega2.lavado })
  )
  ok(
    reciboLavado.includes(`RECIBO LAVADERO No. ${String(lavado2.id).padStart(6, '0')}`),
    'el recibo del lavadero lleva su propia numeración'
  )
  ok(reciboLavado.includes('Descuento acordado') && reciboLavado.includes('$10.000'), 'con el descuento y el total')
  ok(reciboLavado.includes('TRANSFERENCIA'), 'y el método de pago')

  closeDb()

  console.log('\nMigración de una base vieja')
  const carpetaVieja = mkdtempSync(join(tmpdir(), 'parqueadero-migracion-'))
  const vieja = new DatabaseSync(join(carpetaVieja, 'parqueadero.db'))
  vieja.exec(ESQUEMA_VIEJO)
  vieja.close()

  app.setPath('userData', carpetaVieja)
  const migrada = getDb()
  const columnas = (tabla) => migrada.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name)
  ok(
    ['metodo_pago', 'ajuste'].every((c) => columnas('transactions').includes(c)),
    'transactions recibe metodo_pago y ajuste'
  )
  ok(columnas('vehicles').includes('locker'), 'vehicles recibe locker')
  ok(
    ['caja_base_predeterminada', 'horario', 'impresora_sin_tildes', 'politicas_tiquete', 'tramos_hora'].every(
      (c) => columnas('settings').includes(c)
    ),
    'settings recibe todas las columnas nuevas'
  )
  iguales(getSettings().tarifa_hora, 1800, 'la configuración vieja se conserva')
  ok(getSettings().politicas_tiquete.includes('Cascos en custodia'), 'y recibe las políticas del tiquete')
  const viejaTransaccion = transacciones.obtenerPorId(1)
  ok(
    viejaTransaccion.metodo_pago === 'efectivo' && viejaTransaccion.ajuste === 0,
    'el cobro viejo queda en efectivo y sin ajuste'
  )
  iguales(transacciones.totalesEntre('2025-01-01', '2025-12-31').total, 5400, 'y cuenta en las ventas de su fecha')
  ok(columnas('caja_dias').includes('queda_en_caja'), 'caja_dias recibe queda_en_caja')
  iguales(
    resumenCaja('2025-03-11').baseInicial,
    5400,
    'un cierre de antes de esta versión deja en el cajón todo lo contado'
  )
  iguales(lavaderoRepo.listarTipos().length, 0, 'el lavadero arranca vacío en una base migrada')
  closeDb()
  try {
    rmSync(carpetaVieja, { recursive: true, force: true })
  } catch {
    /* Windows a veces retiene el archivo; no afecta la prueba */
  }

  await reglasContraCobroReal()
}

/** Abre una base nueva y vacía; `fn` corre sobre ella y se borra al terminar. */
async function enBaseNueva(fn) {
  const carpeta = mkdtempSync(join(tmpdir(), 'parqueadero-simulacion-'))
  app.setPath('userData', carpeta)
  getDb()
  await fn()
  closeDb()
  try {
    rmSync(carpeta, { recursive: true, force: true })
  } catch {
    /* Windows a veces retiene el archivo; no afecta la prueba */
  }
}

/*
 * Las reglas tal como se le explican al administrador, escritas aparte de
 * `calcularCobro`: si las dos cuentas no coinciden, una está mal.
 */
function cuentaAparte(c, segundos) {
  if (segundos <= c.minutos_gracia * 60) return 0
  const horas = Math.max(1, Math.ceil(segundos / 3600))
  const bloques = Math.ceil(horas / c.horas_tope_dia)
  const regla = c.reglas.find((r) => horas >= r.desde + 1 && horas <= r.hasta)
  return Math.min(regla ? regla.valor : horas * c.tarifa_hora, bloques * c.tarifa_amanecida)
}

const PRECIOS_DE_PRUEBA = [
  // El ejemplo del negocio.
  {
    tarifa_hora: 2000,
    tarifa_amanecida: 15000,
    minutos_gracia: 10,
    horas_tope_dia: 24,
    reglas: [{ desde: 5, hasta: 12, valor: 10000 }]
  },
  // Una regla por encima de la amanecida: manda el tope.
  {
    tarifa_hora: 2000,
    tarifa_amanecida: 10000,
    minutos_gracia: 10,
    horas_tope_dia: 24,
    reglas: [{ desde: 8, hasta: 11, valor: 11110 }]
  },
  // Sin reglas y sin gracia.
  { tarifa_hora: 1500, tarifa_amanecida: 8000, minutos_gracia: 0, horas_tope_dia: 24, reglas: [] },
  // Varias reglas, bloque de 12 h y una regla más allá del primer bloque.
  {
    tarifa_hora: 3000,
    tarifa_amanecida: 20000,
    minutos_gracia: 15,
    horas_tope_dia: 12,
    reglas: [
      { desde: 0, hasta: 2, valor: 4000 },
      { desde: 2, hasta: 6, valor: 9000 },
      { desde: 30, hasta: 40, valor: 35000 }
    ]
  },
  // Una regla que sólo aplica desde el segundo día.
  {
    tarifa_hora: 2000,
    tarifa_amanecida: 30000,
    minutos_gracia: 5,
    horas_tope_dia: 24,
    reglas: [{ desde: 24, hasta: 36, valor: 35000 }]
  }
]

async function reglasContraCobroReal() {
  console.log('\nReglas de cobro contra el cobro real')

  await enBaseNueva(async () => {
    let placa = 0

    for (const [i, c] of PRECIOS_DE_PRUEBA.entries()) {
      const { reglas, ...precios } = c
      actualizarConfiguracion({ ...precios, tramos_hora: JSON.stringify(reglas) })
      const settings = getSettings()
      const nombre = `precios ${i + 1}`

      // Minuto a minuto durante tres días, y un segundo a cada lado de cada hora.
      const entrada = new Date(2026, 5, 10, 8, 0, 0)
      const vehicle = { hora_entrada: aTextoSql(entrada), tipo_tarifa: 'hora' }
      const instantes = new Set()
      for (let s = 0; s <= 72 * 3600; s += 60) instantes.add(s)
      for (let h = 1; h <= 72; h++) [-1, 0, 1].forEach((d) => instantes.add(h * 3600 + d))

      const distintos = [...instantes].filter((s) => {
        // Los milisegundos del reloj no pueden mover el cobro a la hora siguiente.
        const ahora = new Date(entrada.getTime() + s * 1000 + 700)
        return calcularCobro({ vehicle, settings, ahora }).total !== cuentaAparte(c, s)
      })
      iguales(distintos.length, 0, `${nombre}: ${instantes.size} instantes dan la cuenta hecha aparte`)

      const tabla = simularTarifaHora(settings)
      iguales(
        tabla.filter((f) => f.total !== cuentaAparte(c, f.horas * 3600 - 60)).length,
        0,
        `${nombre}: la tabla de Configuración da la misma cuenta`
      )

      // Y lo que de verdad queda cobrado, por el camino de la salida.
      let cobrosMal = 0
      let detalleMal = 0
      for (const f of tabla) {
        const texto = `R${++placa}`
        vehiculos.crearEntrada({
          placa: texto,
          hora_entrada: aTextoSql(new Date(Date.now() - (f.horas * 3600 - 60) * 1000))
        })
        const vista = cotizar({ placa: texto }).cobro
        const { transaccion, cobro } = await liquidar({
          placa: texto,
          metodoPago: 'efectivo',
          imprimir: false
        })
        if (transaccion.monto !== f.total || vista.total !== f.total) cobrosMal++
        if (f.tramo !== cobro.detalle.includes('tramo') || f.tope !== cobro.detalle.includes('tope')) {
          detalleMal++
        }
      }
      iguales(cobrosMal, 0, `${nombre}: cada hora de la tabla se cobra igual en la salida`)
      iguales(detalleMal, 0, `${nombre}: el recibo dice regla o tope donde la tabla lo dice`)
    }

    // Lo que se ve en pantalla cuando una regla queda por encima del tope.
    const c = PRECIOS_DE_PRUEBA[1]
    actualizarConfiguracion({ ...c, tramos_hora: JSON.stringify(c.reglas) })
    const tabla = simularTarifaHora(getSettings())
    ok(!tabla[8].tramo && tabla[8].tope, 'una regla sobre el tope no se pinta como regla')
    iguales(tabla[8].tramoTopado?.valor, 11110, 'y la tabla informa qué regla quedó anulada')

    const settings = getSettings()
    const entrada = new Date(2026, 5, 10, 8, 0, 0)
    const vehicle = { hora_entrada: aTextoSql(entrada), tipo_tarifa: 'hora' }
    const a = (segundos) => new Date(entrada.getTime() + segundos * 1000)
    const total = (segundos, ajustes = settings) =>
      calcularCobro({ vehicle, settings: ajustes, ahora: a(segundos) }).total

    iguales(total(600), 0, 'a los 10 min exactos todavía es gracia')
    iguales(total(601), 2000, 'y un segundo después ya se cobra')
    const sinGracia = { ...settings, minutos_gracia: 0 }
    iguales(total(30, sinGracia), 2000, 'con 0 min de gracia se cobra desde el primer minuto')
    iguales(total(3600), 2000, 'la hora exacta es 1 hora')
    iguales(total(3601), 4000, 'y un segundo más ya es la segunda')
  })
}

correr()
  .catch((error) => {
    fallidas++
    console.error('\nError inesperado:', error)
  })
  .finally(() => {
    console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`)
    try {
      rmSync(carpetaTemporal, { recursive: true, force: true })
    } catch {
      /* Windows a veces retiene el archivo; no afecta la prueba */
    }
    app.exit(fallidas === 0 ? 0 : 1)
  })
