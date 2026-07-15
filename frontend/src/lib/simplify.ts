/** Canvas-pixel point, [x, y]. */
export type XY = [number, number]

function perpendicularDistance(point: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

/** Ramer-Douglas-Peucker polyline simplification. Endpoints are always kept;
 *  interior points survive only if they deviate from the simplified line by more
 *  than `tolerance`. Used to reduce a freehand pointermove stream (hundreds of
 *  near-collinear samples) to a handful of meaningful waypoints while keeping
 *  the sketched shape. Iterative (explicit stack) so long strokes can't blow
 *  the call stack. */
export function simplifyPolyline(points: readonly XY[], tolerance: number): XY[] {
  if (points.length <= 2) return points.map(([x, y]) => [x, y])

  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let maxDistance = tolerance
    let splitIndex = -1
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last])
      if (distance > maxDistance) {
        maxDistance = distance
        splitIndex = i
      }
    }
    if (splitIndex !== -1) {
      keep[splitIndex] = true
      stack.push([first, splitIndex], [splitIndex, last])
    }
  }

  return points.filter((_, i) => keep[i]).map(([x, y]) => [x, y])
}

/** Total length of a polyline in the same units as its coordinates. */
export function polylineLength(points: readonly XY[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}
