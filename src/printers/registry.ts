import type { PrinterProfile } from './types.ts'
import { CR10_SMART } from './creality-cr10-smart.ts'

export const PRINTERS: PrinterProfile[] = [CR10_SMART]

export const DEFAULT_PRINTER_ID = CR10_SMART.id

export function getPrinter(id: string): PrinterProfile | undefined {
  return PRINTERS.find((p) => p.id === id)
}
