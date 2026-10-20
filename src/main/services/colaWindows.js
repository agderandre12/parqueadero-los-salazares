/**
 * Envío de bytes ESC/POS crudos a una impresora instalada en Windows.
 *
 * node-thermal-printer sólo sabe hablar con una cola de Windows a través de un
 * módulo nativo (`printer`, `electron-printer`), y el proyecto evita módulos
 * nativos a propósito (ver `db/index.js`). Sin ese módulo, la interfaz
 * `printer:NOMBRE` de la librería lanza "No driver set!" y no imprime nada.
 *
 * Aquí se hace lo mismo que haría ese módulo — abrir la cola con el tipo de
 * datos RAW y escribir los bytes — pero llamando a `winspool.drv` desde
 * PowerShell, que viene con todo Windows 10/11. El objeto que devuelve
 * `interfazWindows()` cumple el contrato de interfaz de node-thermal-printer
 * (`execute(buffer)` e `isPrinterConnected()`), que acepta objetos propios.
 *
 * Que el trabajo entre a la cola no garantiza que el papel salga: si la
 * impresora está apagada, Windows lo retiene y lo imprime al encenderla.
 */

import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { webContents } from 'electron'

// Los mensajes del script van sin tildes y con un código, porque la consola de
// PowerShell no escribe UTF-8; el texto en español se arma en `traducirError`.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ColaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string Nombre;
    [MarshalAs(UnmanagedType.LPWStr)] public string Archivo;
    [MarshalAs(UnmanagedType.LPWStr)] public string Tipo;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string nombre, out IntPtr h, IntPtr defecto);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h, int nivel, [In] DocInfo doc);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, byte[] datos, int largo, out int escritos);

  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero))
      throw new Exception("ABRIR|" + Marshal.GetLastWin32Error());
    try {
      DocInfo doc = new DocInfo();
      doc.Nombre = "Parqueadero Los Salazares";
      doc.Tipo = "RAW";
      if (StartDocPrinter(h, 1, doc) == 0)
        throw new Exception("DOCUMENTO|" + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int escritos;
        if (!WritePrinter(h, datos, datos.Length, out escritos) || escritos != datos.Length)
          throw new Exception("ESCRIBIR|" + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally {
        EndDocPrinter(h);
      }
    } finally {
      ClosePrinter(h);
    }
  }
}
"@
try {
  [ColaRaw]::Enviar($env:PARQ_IMPRESORA, [IO.File]::ReadAllBytes($env:PARQ_ARCHIVO))
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.Write($e.Message)
  exit 1
}
`

const COMANDO = Buffer.from(SCRIPT, 'utf16le').toString('base64')

const POWERSHELL = join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

/** 'printer:JAL58M' o 'JAL58M' -> 'JAL58M'. */
export function nombreCola(conexion) {
  return String(conexion || '')
    .trim()
    .replace(/^printer:/i, '')
    .trim()
}

function traducirError(nombre, salida) {
  const [, paso, codigo] = /(ABRIR|DOCUMENTO|ESCRIBIR)\|(\d+)/.exec(salida || '') || []
  if (paso === 'ABRIR' && codigo === '1801') {
    return `No existe una impresora llamada "${nombre}" en Windows`
  }
  if (paso === 'ABRIR') return `Windows no dejó abrir la impresora "${nombre}" (código ${codigo})`
  if (paso === 'DOCUMENTO') return `La impresora "${nombre}" rechazó el trabajo (código ${codigo})`
  if (paso === 'ESCRIBIR') return `No se pudo enviar el trabajo a "${nombre}" (código ${codigo})`
  return String(salida || '').trim() || `No se pudo imprimir en "${nombre}"`
}

function ejecutarPowerShell(env) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', COMANDO],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 20000 },
      (error, _stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve())
    )
  })
}

/** Impresoras instaladas en Windows, según Chromium (no abre procesos). */
export async function listarImpresoras() {
  const contenido = webContents.getAllWebContents()[0]
  if (!contenido) return []
  const impresoras = await contenido.getPrintersAsync()
  return impresoras.map((p) => ({ nombre: p.name, etiqueta: p.displayName || p.name }))
}

/** Interfaz de node-thermal-printer que imprime en una cola de Windows. */
export function interfazWindows(conexion) {
  const nombre = nombreCola(conexion)

  return {
    async execute(buffer) {
      if (!nombre) throw new Error('Impresora no configurada')
      if (process.platform !== 'win32') {
        throw new Error('La impresión por nombre de impresora sólo funciona en Windows')
      }

      const archivo = join(tmpdir(), `parqueadero-${randomBytes(6).toString('hex')}.bin`)
      await writeFile(archivo, buffer)
      try {
        await ejecutarPowerShell({ PARQ_IMPRESORA: nombre, PARQ_ARCHIVO: archivo })
        return 'Enviado a la cola de Windows'
      } catch (error) {
        throw new Error(
          error.killed ? `La impresora "${nombre}" no respondió` : traducirError(nombre, error.stderr)
        )
      } finally {
        unlink(archivo).catch(() => {})
      }
    },

    async isPrinterConnected() {
      const instaladas = await listarImpresoras()
      return instaladas.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())
    }
  }
}
