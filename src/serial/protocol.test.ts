import { describe, expect, it } from 'vitest'
import { parseLine, parsePosition, parseTemperatures } from './protocol.ts'

// Real lines captured from a CR-10 Smart (Creality firmware 1.0.14).
describe('parseLine', () => {
  it('recognises a bare ok', () => {
    expect(parseLine('ok').kind).toBe('ok')
  })

  it('extracts temperatures from the ok M105 returns', () => {
    const parsed = parseLine('ok T:23.98 /0.00 B:24.37 /0.00 @:0 B@:0 FAN0@:0')
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    expect(parsed.temperatures?.nozzle).toEqual({ current: 23.98, target: 0 })
    expect(parsed.temperatures?.bed).toEqual({ current: 24.37, target: 0 })
  })

  it('splits the text out of echo lines', () => {
    const parsed = parseLine('echo:  M420 S1 Z2.00')
    expect(parsed.kind).toBe('echo')
    if (parsed.kind !== 'echo') return
    expect(parsed.text.trim()).toBe('M420 S1 Z2.00')
  })

  it('treats "Taring probe" as data, not as an error', () => {
    // The probe is a load cell and tares before every touch: hundreds of these
    // arrive during a G29. They are a sign of life, not a problem.
    expect(parseLine('Taring probe').kind).toBe('data')
  })

  it('recognises busy and wait', () => {
    expect(parseLine('busy: processing').kind).toBe('busy')
    expect(parseLine('wait').kind).toBe('wait')
  })

  it('recognises errors', () => {
    const parsed = parseLine('Error:Probing Failed')
    expect(parsed.kind).toBe('error')
    if (parsed.kind !== 'error') return
    expect(parsed.message).toBe('Probing Failed')
  })

  it('recognises the position M114 reports', () => {
    const parsed = parseLine('X:150.00 Y:150.00 Z:5.00 E:0.00 Count X:12000 Y:12000 Z:2000')
    expect(parsed.kind).toBe('position')
    if (parsed.kind !== 'position') return
    expect(parsed.position).toEqual({ x: 150, y: 150, z: 5 })
  })

  it('does not mistake a mesh line for a position', () => {
    expect(parseLine('echo:  G29 W I0 J0 Z0.16250').kind).toBe('echo')
  })
})

describe('standalone parsers', () => {
  it('returns undefined when there is nothing to parse', () => {
    expect(parseTemperatures('Taring probe')).toBeUndefined()
    expect(parsePosition('ok')).toBeUndefined()
  })

  it('reads negative temperatures and high targets', () => {
    expect(parseTemperatures('T:-0.50 /200.00')).toEqual({
      nozzle: { current: -0.5, target: 200 },
    })
  })
})
