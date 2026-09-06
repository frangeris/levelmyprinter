import type { LevelingSystem, PrinterProfile, Vec3 } from '../printers/types.ts'
import type { MeshPoint } from './types.ts'
import { parseM503 } from './parseM503.ts'

/**
 * What the printer says about itself.
 *
 * Every field here comes from a read-only reply, never from a constant someone
 * typed. That is the point: a profile is a convenience and a fallback, not the
 * source of truth, and anything the machine can be asked should be asked.
 */
export interface DetectedPrinter {
  /** `MACHINE_TYPE` from `M115`. */
  machine: string | null
  firmware: string | null
  /**
   * `UUID` from `M115` — identity of *this* machine, not of the model.
   *
   * Which is what makes "the grid has been pinned" a fact worth remembering:
   * the bounds live in that printer's EEPROM, so the record has to be keyed to
   * the printer, not to a profile two machines could share.
   */
  uuid: string | null
  /** `Cap:NAME:1` flags, which say what the firmware was built with. */
  capabilities: Record<string, boolean>
  /** Grid size, counted from the mesh `M503` serialises. */
  mesh: { cols: number; rows: number } | null
  /**
   * The points themselves, exactly as the firmware listed them.
   *
   * `M503` replays its mesh as one `G29 W I.. J.. Z..` per point, so *which*
   * points exist is not something the app has to work out — it is read. What
   * those lines never carry is a millimetre: the indices are the machine's
   * word, the positions are not (see `parseM503`, which fills `pos` with NaN).
   */
  meshPoints: { i: number; j: number }[]
  /**
   * Which leveling system, from the shape of the commands `M503` replays.
   *
   * Each system stores its mesh with a different command, and the firmware
   * hands us the one it uses. Guessing here would mean writing `G29 W` at a
   * firmware expecting `M421` — accepted as nothing, or as something else.
   */
  leveling: LevelingSystem | null
  /** Soft endstops from `M211`. */
  travel: { min: Vec3; max: Vec3 } | null
  /** mm per full Z step, from `M92` — the finest move the machine can make. */
  zResolution: number | null
  /** Z ceiling from `M203`, converted to mm/min. */
  maxFeedrateZ: number | null
  /** X/Y ceiling from `M203`, mm/min. */
  maxFeedrateXY: number | null
  /** First preset from `M145` — `H` nozzle, `B` bed. */
  preheat: { nozzle: number; bed: number } | null
  /** `M420 S.. Z..` — whether compensation is on and where it fades out. */
  fadeHeight: number | null
  /** `M851 X.. Y.. Z..` — where the probe sits relative to the nozzle. */
  probeOffset: { x: number; y: number; z: number } | null
}

const num = (value: string | undefined): number => Number(value)

/**
 * `MACHINE_TYPE:CR-10 Smart EXTRUDER_COUNT:1` — the value runs to the next KEY:.
 *
 * The terminator has to accept mixed case: the identity line ends with
 * `Cap:WIFI:0`, and a key pattern of capitals alone swallows it into the UUID.
 */
function field(raw: string, key: string): string | null {
  const match = new RegExp(`${key}:(.*?)(?:\\s+[A-Za-z_0-9]+:|$)`, 'm').exec(raw)
  return match?.[1]?.trim() || null
}

/**
 * Grid size straight from the mesh.
 *
 * The highest index the firmware reports *is* the grid — no need to know the
 * model. A `G29 W I4 J4` means 5 columns whether it came from a Creality or
 * anything else.
 */
export function meshDimensions(mesh: MeshPoint[]): { cols: number; rows: number } | null {
  if (mesh.length === 0) return null
  return {
    cols: Math.max(...mesh.map((point) => point.i)) + 1,
    rows: Math.max(...mesh.map((point) => point.j)) + 1,
  }
}

/** The command each system uses to serialise one mesh point. */
function detectLeveling(raw: string): LevelingSystem | null {
  if (/^(?:echo:)?\s*G29 W I\d+ J\d+/m.test(raw)) return 'bilinear'
  if (/^(?:echo:)?\s*M421 I\d+ J\d+/m.test(raw)) return 'ubl'
  if (/^(?:echo:)?\s*G29 S3 X\d+ Y\d+/m.test(raw)) return 'mbl'
  if (/Bilinear Leveling Grid/.test(raw)) return 'bilinear'
  if (/Unified Bed Leveling|UBL /.test(raw)) return 'ubl'
  return null
}

/** Reads everything derivable out of the concatenated `M115`/`M211`/`M503` replies. */
export function detectPrinter(raw: string): DetectedPrinter {
  const settings = parseM503(raw)
  const capabilities: Record<string, boolean> = {}
  // Not anchored to the line start: M115 puts the first Cap: at the tail of the
  // long identity line and the rest on their own.
  for (const match of raw.matchAll(/\bCap:([A-Z_0-9]+):([01])\b/g)) {
    capabilities[match[1]!] = match[2] === '1'
  }

  const endstops =
    /Min:\s*X(-?[\d.]+)\s*Y(-?[\d.]+)\s*Z(-?[\d.]+)\s*Max:\s*X(-?[\d.]+)\s*Y(-?[\d.]+)\s*Z(-?[\d.]+)/.exec(
      raw,
    )

  // The `echo:` prefix is optional: M503 pads its replies with it, a raw
  // terminal transcript may not.
  const stepsZ = /^(?:echo:)?\s*M92\b.*?\bZ([\d.]+)/m.exec(raw)
  // M203 is in units/s; everything else in the app is mm/min.
  const feedZ = /^(?:echo:)?\s*M203\b.*?\bZ([\d.]+)/m.exec(raw)
  const feedX = /^(?:echo:)?\s*M203\b.*?\bX([\d.]+)/m.exec(raw)
  const feedY = /^(?:echo:)?\s*M203\b.*?\bY([\d.]+)/m.exec(raw)
  // M145 lists a preset per material; S0 is the first one the machine offers.
  const preheat = /^(?:echo:)?\s*M145 S0\b.*?\bH(\d+).*?\bB(\d+)/m.exec(raw)

  return {
    machine: field(raw, 'MACHINE_TYPE'),
    firmware: field(raw, 'FIRMWARE_NAME'),
    uuid: field(raw, 'UUID'),
    capabilities,
    mesh: meshDimensions(settings.mesh),
    meshPoints: settings.mesh.map((point) => ({ i: point.i, j: point.j })),
    leveling: detectLeveling(raw),
    travel: endstops
      ? {
          min: { x: num(endstops[1]), y: num(endstops[2]), z: num(endstops[3]) },
          max: { x: num(endstops[4]), y: num(endstops[5]), z: num(endstops[6]) },
        }
      : null,
    zResolution: stepsZ ? 1 / num(stepsZ[1]) : null,
    maxFeedrateZ: feedZ ? num(feedZ[1]) * 60 : null,
    maxFeedrateXY: feedX && feedY ? Math.min(num(feedX[1]), num(feedY[1])) * 60 : null,
    preheat: preheat ? { nozzle: num(preheat[1]), bed: num(preheat[2]) } : null,
    fadeHeight: settings.leveling?.fadeHeight ?? null,
    probeOffset: settings.probeOffset ?? null,
  }
}

/**
 * Where the profile and the machine disagree.
 *
 * Only the disagreements that would corrupt something or crash something. A
 * grid of the wrong size is the dangerous one: the app would draw points that
 * do not exist and write measurements to indices the firmware will refuse.
 */
export function profileMismatches(profile: PrinterProfile, detected: DetectedPrinter): string[] {
  const problems: string[] = []

  if (detected.mesh) {
    const { cols, rows } = detected.mesh
    if (cols !== profile.mesh.cols || rows !== profile.mesh.rows) {
      problems.push(
        `the printer's mesh is ${cols}×${rows}, this profile assumes ${profile.mesh.cols}×${profile.mesh.rows}`,
      )
    }
  }

  if (detected.travel) {
    const { max } = detected.travel
    if (max.x < profile.bed.width || max.y < profile.bed.depth) {
      problems.push(
        `the bed is drawn ${profile.bed.width}×${profile.bed.depth} mm but travel stops at X${max.x} Y${max.y}`,
      )
    }
  }

  if (detected.maxFeedrateZ !== null && profile.feedrates.travelZ > detected.maxFeedrateZ) {
    problems.push(
      `Z moves are sent at ${profile.feedrates.travelZ} mm/min, above the firmware ceiling of ${detected.maxFeedrateZ}`,
    )
  }

  const finest = Math.min(...profile.jog.steps)
  if (detected.zResolution !== null && finest < detected.zResolution) {
    problems.push(
      `the finest jog step is ${finest} mm but the machine resolves ${detected.zResolution} mm`,
    )
  }

  return problems
}
