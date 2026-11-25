const RAD = Math.PI / 180
const EQUATOR_M_PER_PX = 156543.03392
const MAX_TILES = 80
const MAX_CACHED = 400
const RETRY_MS = 60_000
export const TILE_PATH = '/maptiles/'

export interface TileSource {
  id: string
  maxZoom: number
  attribution: string
}

export const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z

export const tileY = (lat: number, z: number) =>
  ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * 2 ** z

export const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180

export const tileLat = (y: number, z: number) =>
  Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD

export function zoomFor(metersPerPixel: number, lat: number, maxZoom: number): number {
  if (!(metersPerPixel > 0)) return 0
  const z = Math.ceil(Math.log2((EQUATOR_M_PER_PX * Math.cos(lat * RAD)) / metersPerPixel))
  return Math.min(maxZoom, Math.max(0, z))
}

export interface TileView {
  w: number
  h: number
  metersPerPixel: number
  toLatLon(px: number, py: number): [number, number]
  toPx(lat: number, lon: number): [number, number]
}

export interface TileRange {
  z: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export function tilesIn(view: TileView, maxZoom: number): TileRange | null {
  const [north, west] = view.toLatLon(0, 0)
  const [south, east] = view.toLatLon(view.w, view.h)
  if (
    ![north, west, south, east].every(Number.isFinite) ||
    Math.abs(north) > 85 ||
    Math.abs(south) > 85
  )
    return null
  let z = zoomFor(view.metersPerPixel, (north + south) / 2, maxZoom)
  for (; z >= 0; z--) {
    const last = 2 ** z - 1
    const clamp = (v: number) => Math.min(last, Math.max(0, Math.floor(v)))
    const range = {
      z,
      x0: clamp(tileX(west, z)),
      x1: clamp(tileX(east, z)),
      y0: clamp(tileY(north, z)),
      y1: clamp(tileY(south, z)),
    }
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= MAX_TILES) return range
  }
  return null
}

interface Entry {
  img: HTMLImageElement
  state: 'loading' | 'ok' | 'failed'
  at: number
  waiting: Set<() => void>
}

const cache = new Map<string, Entry>()

function request(key: string, onLoad: () => void): Entry {
  let e = cache.get(key)
  if (e && e.state === 'failed' && Date.now() - e.at > RETRY_MS) {
    cache.delete(key)
    e = undefined
  }
  if (!e) {
    const img = new Image()
    const entry: Entry = { img, state: 'loading', at: Date.now(), waiting: new Set() }
    const settle = (state: Entry['state']) => () => {
      entry.state = state
      entry.at = Date.now()
      const waiting = [...entry.waiting]
      entry.waiting.clear()
      if (state === 'ok') for (const fn of waiting) fn()
    }
    img.onload = settle('ok')
    img.onerror = settle('failed')
    img.src = TILE_PATH + key
    cache.set(key, entry)
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    e = entry
  } else {
    cache.delete(key)
    cache.set(key, e)
  }
  if (e.state === 'loading') e.waiting.add(onLoad)
  return e
}

export function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: TileView,
  source: TileSource,
  onLoad: () => void,
): { drawn: number; failed: number; total: number } {
  const out = { drawn: 0, failed: 0, total: 0 }
  const range = tilesIn(view, source.maxZoom)
  if (!range) return out
  const { z } = range
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      out.total++
      const e = request(`${source.id}/${z}/${x}/${y}`, onLoad)
      if (e.state === 'failed') out.failed++
      if (e.state !== 'ok') continue
      const [px0, py0] = view.toPx(tileLat(y, z), tileLon(x, z))
      const [px1, py1] = view.toPx(tileLat(y + 1, z), tileLon(x + 1, z))
      ctx.drawImage(e.img, px0, py0, px1 - px0 + 0.5, py1 - py0 + 0.5)
      out.drawn++
    }
  }
  return out
}

export function drawAttribution(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  if (!text) return
  ctx.save()
  ctx.font = '10px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'right'
  const width = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(9, 9, 11, 0.7)'
  ctx.fillRect(w - width - 10, h - 16, width + 10, 16)
  ctx.fillStyle = '#d4d4d8'
  ctx.fillText(text, w - 5, h - 3)
  ctx.restore()
}
