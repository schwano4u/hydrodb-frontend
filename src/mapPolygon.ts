export type MapPoint = [number, number]
export const MAX_POLYGON_VERTICES = 64
const halfWorld = Math.PI * 6378137
const world = 2 * halfWorld

export function wrapMapX(x: number, referenceX: number) {
  return x + Math.round((referenceX - x) / world) * world
}

function turn(a: MapPoint, b: MapPoint, c: MapPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function within(a: MapPoint, b: MapPoint, c: MapPoint) {
  return c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0])
    && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1])
}

function crosses(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  const u = turn(a, b, c), v = turn(a, b, d), w = turn(c, d, a), x = turn(c, d, b)
  return (u === 0 && within(a, b, c)) || (v === 0 && within(a, b, d))
    || (w === 0 && within(c, d, a)) || (x === 0 && within(c, d, b))
    || (u * v < 0 && w * x < 0)
}

export function finishMapPolygon(points: MapPoint[]): MapPoint[] {
  if (points.length < 3) throw new Error('Add at least three distinct vertices to finish the polygon.')
  const offset = Math.floor((points[0]![0] + halfWorld) / world) * world
  const ring: MapPoint[] = points.map(([x, y]) => [x - offset, Math.max(-halfWorld, Math.min(halfWorld, y))])
  const xs = ring.map(([x]) => x)
  if (Math.max(...xs) - Math.min(...xs) > world) throw new Error('Draw the polygon within one map world.')
  let area = 0
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!
    const c = ring[(i + 2) % ring.length]!
    if (ring.slice(0, i).some(([x, y]) => x === a[0] && y === a[1])) {
      throw new Error('Use distinct vertices. Undo the last vertex to correct the polygon.')
    }
    if ((turn(a, b, c) === 0 && (within(a, b, c) || within(b, c, a)))
      || ring.slice(i + 2).some((point, index) => {
        const j = i + 2 + index
        return (i !== 0 || j !== ring.length - 1) && crosses(a, b, point, ring[(j + 1) % ring.length]!)
      })) {
      throw new Error('The polygon crosses itself. Undo vertices to correct it.')
    }
    area += turn(ring[0]!, a, b)
  }
  if (area === 0) throw new Error('The polygon must cover an area. Undo vertices to correct it.')
  return ring
}
