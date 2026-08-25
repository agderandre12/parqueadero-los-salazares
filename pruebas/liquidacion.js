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
import { getSettings } from '../src/main/db/settingsRepo.js'
import { cotizar, liquidar } from '../src/main/services/liquidacion.js'
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

  console.log('\nOtras tarifas')
  const vMes = entradaHace('MEN001', 5, { tipo_tarifa: 'mensualidad' })
  iguales(
    (await liquidar({ vehicleId: vMes.id, metodoPago: 'efectivo' })).transaccion.monto,
    0,
    'mensualidad no cobra a la salida'
  )

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
  const efectivoEsperado = 3 * settings.tarifa_hora + 0 + 5000 + settings.tarifa_amanecida
  const transferenciaEsperada = settings.tarifa_hora + settings.cargo_ticket_perdido

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
