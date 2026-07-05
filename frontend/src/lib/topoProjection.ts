import type { GridData } from '../types/terrain'

export interface TopoProjection {
  /** Project a raw [lon, lat] (OSM features, unit/objective/route positions) to canvas px. */
  projectLonLat: (lon: number, lat: number) => [number, number]
  /** Project a grid-cell-space coordinate (traceContour's output, 0..width-1/0..height-1
   *  floats) to canvas px. */
  projectCell: (cx: number, cy: number) => [number, number]
  /** Meters-per-pixel along the horizontal axis, for converting radii (e.g. an
   *  objective's capture radius) into canvas pixels. Flat-earth approximation --
   *  fine at this <=3km selection scale. */
  metersPerPixelX: number
}

/** Grid-cell space is already an affine reparameterization of the same bbox as raw
 *  lon/lat (cell (0,0) = NW corner, (width-1,height-1) = SE corner, matching
 *  GridData's row-major/north-first convention) -- both projectLonLat and
 *  projectCell reduce to the same fx,fy in [0,1] before the final canvas-size
 *  multiply, so a contour segment and an OSM feature at the same physical point
 *  land on the identical pixel. Mirrors the fx/fy convention already established in
 *  grid.ts's cellIndexAt. */
export function makeTopoProjection(grid: GridData, canvasWidth: number, canvasHeight: number): TopoProjection {
  const { bbox } = grid

  const projectLonLat = (lon: number, lat: number): [number, number] => {
    const fx = (lon - bbox.west) / (bbox.east - bbox.west)
    const fy = (bbox.north - lat) / (bbox.north - bbox.south)
    return [fx * canvasWidth, fy * canvasHeight]
  }

  const projectCell = (cx: number, cy: number): [number, number] => {
    const fx = cx / (grid.width - 1)
    const fy = cy / (grid.height - 1)
    return [fx * canvasWidth, fy * canvasHeight]
  }

  const centerLatRadians = ((bbox.south + bbox.north) / 2) * (Math.PI / 180)
  const metersPerDegreeLon = 111_320 * Math.cos(centerLatRadians)
  const bboxWidthMeters = (bbox.east - bbox.west) * metersPerDegreeLon
  const metersPerPixelX = bboxWidthMeters / canvasWidth

  return { projectLonLat, projectCell, metersPerPixelX }
}
