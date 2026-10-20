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

import { getDb, closeDb } from '../src/main/db/index.js'
import * as vehiculos from '../src/main/db/vehiclesRepo.js'
import * as transacciones from '../src/main/db/transactionsRepo.js'
import { getSettings, updateSettings } from '../src/main/db/settingsRepo.js'
import { cotizar, liquidar } from '../src/main/services/liquidacion.js'
import {
  componerRecibo,
  componerTiquete,
  generarBytes,
  imprimirTiquete,
  plegar
} from '../src/main/services/printer.js'
import { nombreCola } from '../src/main/services/colaWindows.js'
import { registrarEntrada, cobroMensualidad } from '../src/main/services/entrada.js'
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

  closeDb()
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
