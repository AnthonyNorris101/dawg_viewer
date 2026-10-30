import { validPanels } from './graphProfiles'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// Version 1: 4-bit version, 1-bit width, 3-bit chart count, then each
// chart's 4-bit entry count and 22/32-bit hashes. CRC-16 covers the payload.
function crc(bits: string): number {
  let value = 0xffff
  for (const bit of bits) {
    const top = (value >>> 15) ^ Number(bit)
    value = (value << 1) & 0xffff
    if (top) value ^= 0x1021
  }
  return value
}
const binary = (n: number, width: number) => n.toString(2).padStart(width, '0')
export async function nameHash(name: string, width: number): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  return new DataView(digest).getUint32(0) >>> (32 - width)
}

export async function encodeGraphCode(panels: string[][], cacheSize: number): Promise<string> {
  if (!validPanels(panels)) throw new Error('Use at most 5 charts and 15 channels total.')
  const unresolved = panels.flat().find((n) => n.startsWith('~'))
  const width = unresolved ? Number(unresolved.split(':')[0].slice(1)) : cacheSize <= 256 ? 22 : 32
  if ((15 * Math.max(0, cacheSize - 1)) / 2 ** width >= 0.001)
    throw new Error('The channel cache is too large for this code format.')
  let bits = binary(1, 4) + binary(width === 32 ? 1 : 0, 1) + binary(panels.length, 3)
  for (const panel of panels) {
    bits += binary(panel.length, 4)
    for (const name of panel) {
      const hash = name.startsWith('~') ? Number(name.split(':')[1]) : await nameHash(name, width)
      bits += binary(hash, width)
    }
  }
  bits += binary(crc(bits), 16)
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0')
  return bits
    .match(/.{5}/g)!
    .map((b) => ALPHABET[parseInt(b, 2)])
    .join('')
}

export function decodeGraphCode(code: string): string[][] {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '')
  if (!normalized || normalized.length > 105 || [...normalized].some((c) => !ALPHABET.includes(c)))
    throw new Error('Invalid graph code.')
  const bits = [...normalized].map((c) => binary(ALPHABET.indexOf(c), 5)).join('')
  let offset = 0
  const read = (n: number) => {
    if (offset + n > bits.length) throw new Error('Incomplete graph code.')
    const value = parseInt(bits.slice(offset, offset + n), 2)
    offset += n
    return value
  }
  if (read(4) !== 1) throw new Error('Unsupported graph code version.')
  const width = read(1) ? 32 : 22
  const count = read(3)
  if (count < 1 || count > 5) throw new Error('Invalid chart count.')
  const panels = Array.from({ length: count }, () =>
    Array.from({ length: read(4) }, () => `~${width}:${read(width)}`),
  )
  if (!validPanels(panels)) throw new Error('Use at most 5 charts and 15 channels total.')
  const payload = bits.slice(0, offset)
  if (read(16) !== crc(payload) || bits.length - offset >= 5 || /1/.test(bits.slice(offset)))
    throw new Error('Graph code checksum failed.')
  return panels
}

export async function resolvePanels(panels: string[][], names: string[]): Promise<string[][]> {
  const widths = [
    ...new Set(
      panels
        .flat()
        .filter((n) => n.startsWith('~'))
        .map((n) => Number(n.split(':')[0].slice(1))),
    ),
  ]
  const matches = new Map<string, string[]>()
  for (const width of widths) {
    if ((15 * Math.max(0, names.length - 1)) / 2 ** width >= 0.001) continue
    for (const name of new Set(names)) {
      const key = `~${width}:${await nameHash(name, width)}`
      matches.set(key, [...(matches.get(key) ?? []), name])
    }
  }
  return panels.map((p) => p.map((n) => (matches.get(n)?.length === 1 ? matches.get(n)![0] : n)))
}
