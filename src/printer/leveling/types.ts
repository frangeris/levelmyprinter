import type { PrinterProfile } from '../../printers/types.ts'

/**
 * Adapter per leveling system. The UI consumes this interface and never writes
 * system-specific gcode, so adding MBL/UBL/Klipper touches neither the UI nor
 * the serial layer. See PLAN.md 5.3.
 */
export interface LevelingStrategy {
  id: PrinterProfile['leveling']

  /**
   * The firmware's own auto bed levelling, with the grid's physical bounds
   * spelled out — which is what makes the index↔mm mapping known rather than
   * guessed. It probes every point and replaces the mesh.
   */
  buildAutoLevel(profile: PrinterProfile): string[]

  /** Turns leveling compensation on or off. */
  buildEnable(on: boolean): string

  /** Writes one point's value (still in RAM). */
  buildWritePoint(i: number, j: number, z: number): string

  /** Persists whatever was written to EEPROM. */
  buildPersist(): string

  /** Re-reads stored state, to verify the write took effect. */
  buildVerify(): string
}
