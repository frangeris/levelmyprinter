import { describe, expect, it } from 'vitest'
import { CR10_SMART } from '../../printers/creality-cr10-smart.ts'
import { bilinear } from '../../printer/leveling/bilinear.ts'
import {
  buildGotoPointStep,
  buildJogStep,
  buildPersistStep,
  buildPrepareSteps,
  buildReloadStep,
  buildVerifyStep,
  buildWriteSteps,
} from './sequences.ts'

const flatten = (steps: { commands: string[] }[]) => steps.flatMap((s) => s.commands)

const FULL = { preheat: true, probe: true }

describe('prepare sequence', () => {
  const commands = flatten(buildPrepareSteps(CR10_SMART, bilinear, FULL))

  it('preheats before homing and probing', () => {
    // The bed deforms as it heats: probing cold measures a different surface.
    const heated = commands.indexOf('M109 S200')
    const homed = commands.indexOf('G28')
    expect(heated).toBeGreaterThanOrEqual(0)
    expect(homed).toBeGreaterThan(heated)
  })

  it('requests both temperatures before waiting on either', () => {
    // Otherwise bed and nozzle heat in series instead of in parallel.
    expect(commands.indexOf('M140 S60')).toBeLessThan(commands.indexOf('M190 S60'))
    expect(commands.indexOf('M104 S200')).toBeLessThan(commands.indexOf('M190 S60'))
  })

  it('pins the grid bounds that meshGeometry assumes', () => {
    // This command is what makes the index↔mm mapping exact: if it changes here
    // and not in the profile, every measurement lands on the wrong point.
    expect(commands).toContain('G29 L20 R280 F20 B280')
  })

  it('disables compensation AFTER probing', () => {
    // The G29 leaves leveling switched on. With a 2 mm fade height, paper
    // testing without disabling it would measure the old mesh plus the new one.
    const probed = commands.indexOf('G29 L20 R280 F20 B280')
    const disabled = commands.lastIndexOf('M420 S0')
    expect(disabled).toBeGreaterThan(probed)
  })
})

describe('optional prepare steps', () => {
  it('skips the heat-up but still homes and disables compensation', () => {
    // Testing the motion should not cost a five-minute heat-up.
    const commands = flatten(
      buildPrepareSteps(CR10_SMART, bilinear, { preheat: false, probe: true }),
    )
    expect(commands).not.toContain('M109 S200')
    expect(commands).toContain('G28')
    expect(commands).toContain('M420 S0')
  })

  it('skips probing but still homes and disables compensation', () => {
    const commands = flatten(
      buildPrepareSteps(CR10_SMART, bilinear, { preheat: true, probe: false }),
    )
    expect(commands.some((c) => c.startsWith('G29'))).toBe(false)
    expect(commands).toContain('G28')
    // Compensation left over in EEPROM would skew the paper reading just the
    // same as this session's own probe run would.
    expect(commands).toContain('M420 S0')
  })

  it('always homes, even with everything else skipped', () => {
    // Nothing may move before the machine knows where it is.
    const commands = flatten(
      buildPrepareSteps(CR10_SMART, bilinear, { preheat: false, probe: false }),
    )
    expect(commands).toEqual(['G28', 'M420 S0', 'G90'])
  })

  it('heats to the temperatures the dialog was given, not the profile defaults', () => {
    // The preheat dialog shows these as editable fields. If the overrides did
    // not reach the machine, it would be showing a number it then ignores.
    const commands = flatten(
      buildPrepareSteps(CR10_SMART, bilinear, {
        preheat: true,
        probe: false,
        nozzle: 150,
        bed: 50,
      }),
    )
    expect(commands).toContain('M104 S150')
    expect(commands).toContain('M109 S150')
    expect(commands).toContain('M140 S50')
    expect(commands).toContain('M190 S50')
    expect(commands).not.toContain('M109 S200')
  })

  it('falls back to the profile when no temperature is given', () => {
    const commands = flatten(
      buildPrepareSteps(CR10_SMART, bilinear, { preheat: true, probe: false }),
    )
    expect(commands).toContain('M109 S200')
    expect(commands).toContain('M190 S60')
  })
})

describe('moving between points', () => {
  it('lifts, travels, and only then descends', () => {
    const { commands } = buildGotoPointStep(CR10_SMART, { x: 280, y: 280 }, 0.2)
    expect(commands).toEqual(['G1 Z5.000 F300', 'G1 X280.00 Y280.00 F3000', 'G1 Z0.200 F300'])
  })

  it('never exceeds the firmware Z speed ceiling', () => {
    // M203 Z5.00 mm/s = 300 mm/min. Marlin would clamp anyway, but sending more
    // hides the mistake until someone copies the number into another profile.
    const zMoves = [
      ...buildGotoPointStep(CR10_SMART, { x: 20, y: 20 }, 0.2).commands,
      ...buildJogStep(CR10_SMART, -0.1).commands,
    ].filter((c) => c.includes('Z') && c.includes('F'))

    expect(zMoves.length).toBeGreaterThan(0)
    for (const move of zMoves) {
      const feedrate = Number(/F(\d+)/.exec(move)![1])
      expect(feedrate).toBeLessThanOrEqual(300)
    }
  })
})

describe('jog', () => {
  it('sends absolute Z, not increments', () => {
    // Absolute so 200 clicks do not accumulate drift.
    expect(buildJogStep(CR10_SMART, -0.125).commands).toEqual(['G1 Z-0.125 F120'])
  })

  it('does not lose precision to format rounding', () => {
    // The profile finest step is 0.01, but the machine resolves 0.0025.
    expect(buildJogStep(CR10_SMART, -0.005).commands).toEqual(['G1 Z-0.005 F120'])
  })

  it('clamps against the downward safety floor', () => {
    expect(buildJogStep(CR10_SMART, -50).commands).toEqual(['G1 Z-2.000 F120'])
  })
})

describe('writing the mesh', () => {
  const points = [
    { i: 0, j: 0, z: 0.1625 },
    { i: 1, j: 0, z: -0.117 },
  ]

  it('emits one M421 per point — the command that does not clear the grid', () => {
    // Same shape *and* the same 5 decimals M503 uses to serialize its mesh,
    // which is what makes these lines replayable in the first place — and what
    // keeps a value loaded from the printer from being rounded on the way back.
    expect(buildWriteSteps(bilinear, points).flatMap((s) => s.commands)).toEqual([
      'M421 I0 J0 Z0.16250',
      'M421 I1 J0 Z-0.11700',
    ])
  })

  it('labels each write with its progress', () => {
    // This is the riskiest operation in the app; an opaque "writing…" is worth
    // far less to someone watching than a point count.
    expect(buildWriteSteps(bilinear, points)[1]?.label).toBe('Writing point 2 of 2 (I1 J0)')
  })

  it('keeps persist, reload and read-back as separate steps', () => {
    // The order is the whole guarantee: M503 dumps live settings, so without
    // M501 in between it would echo back the RAM we just wrote and prove
    // nothing about what reached EEPROM.
    expect(buildPersistStep(bilinear).commands).toEqual(['M500'])
    expect(buildReloadStep().commands).toEqual(['M501'])
    expect(buildVerifyStep(bilinear).commands).toEqual(['M503'])
  })

  it('does not bundle the save into the point writes', () => {
    const commands = buildWriteSteps(bilinear, points).flatMap((s) => s.commands)
    expect(commands.some((c) => c === 'M500')).toBe(false)
  })
})
