import { describe, expect, it } from 'vitest'
import { tileLat, tileLon, tilesIn, tileX, tileY, zoomFor, type TileView } from './tiles'

const RAD = Math.PI / 180
const EARTH_R = 6371008.8

function viewAt(lat0: number, lon0: number, w: number, h: number, scale: number): TileView {
  const kx = Math.cos(lat0 * RAD) * RAD * EARTH_R
  const ky = RAD * EARTH_R
  return {
    w,
    h,
    metersPerPixel: 1 / scale,
    toLatLon: (px, py) => [lat0 - (py - h / 2) / scale / ky, lon0 + (px - w / 2) / scale / kx],
    toPx: (lat, lon) => [w / 2 + (lon - lon0) * kx * scale, h / 2 - (lat - lat0) * ky * scale],
  }
}

describe('map tiles', () => {
  it('finds the tile a place is on and turns tile corners back into coordinates', () => {
    expect(Math.floor(tileX(-83.37335, 18))).toBe(70361)
    expect(Math.floor(tileY(33.94975, 18))).toBe(104762)
    expect(tileX(-180, 3)).toBe(0)
    expect(tileY(0, 3)).toBeCloseTo(4)
    expect(tileLon(tileX(-83.37335, 18), 18)).toBeCloseTo(-83.37335, 9)
    expect(tileLat(tileY(33.94975, 18), 18)).toBeCloseTo(33.94975, 9)
    expect(tileLat(104762, 18)).toBeGreaterThan(33.94975)
    expect(tileLat(104763, 18)).toBeLessThan(33.94975)
  })

  it('picks a zoom at least as sharp as the screen, up to what the source has', () => {
    const z = zoomFor(0.5, 34, 19)
    const resolution = (156543.03392 * Math.cos(34 * RAD)) / 2 ** z
    expect(resolution).toBeLessThanOrEqual(0.5)
    expect(resolution * 2).toBeGreaterThan(0.5)
    expect(zoomFor(0.01, 34, 19)).toBe(19)
    expect(zoomFor(1e9, 34, 19)).toBe(0)
    expect(zoomFor(0, 34, 19)).toBe(0)
  })

  it('covers the whole view with a bounded number of tiles', () => {
    const view = viewAt(33.948, -83.377, 800, 500, 2)
    const range = tilesIn(view, 19)!
    expect(range.z).toBe(zoomFor(0.5, 33.948, 19))
    const [north, west] = view.toLatLon(0, 0)
    const [south, east] = view.toLatLon(800, 500)
    expect(tileLon(range.x0, range.z)).toBeLessThanOrEqual(west)
    expect(tileLon(range.x1 + 1, range.z)).toBeGreaterThanOrEqual(east)
    expect(tileLat(range.y0, range.z)).toBeGreaterThanOrEqual(north)
    expect(tileLat(range.y1 + 1, range.z)).toBeLessThanOrEqual(south)
    const count = (r: NonNullable<ReturnType<typeof tilesIn>>) =>
      (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
    expect(count(range)).toBeLessThanOrEqual(80)
    const huge = tilesIn(viewAt(33.948, -83.377, 4000, 3000, 2), 19)!
    expect(count(huge)).toBeLessThanOrEqual(80)
    expect(huge.z).toBeLessThan(range.z)
    const [px, py] = view.toPx(tileLat(range.y0, range.z), tileLon(range.x0, range.z))
    expect(px).toBeLessThanOrEqual(0)
    expect(py).toBeLessThanOrEqual(0)
    expect(tilesIn(viewAt(89, 0, 800, 500, 2), 19)).toBeNull()
  })
})
