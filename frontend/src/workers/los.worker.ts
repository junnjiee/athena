import { computeViewshed } from '../lib/los'

export interface ViewshedRequest {
  requestId: number
  width: number
  height: number
  cellMeters: number
  /** copies of the grid channels — transferred in, never the live grid buffer */
  elevation: ArrayBuffer
  cls: ArrayBuffer
  col: number
  row: number
  eyeHeightM?: number
}

export interface ViewshedResponse {
  requestId: number
  mask: Uint8Array
}

/** Off-main-thread viewshed for the interactive "show what this unit sees" toggle —
 *  keeps the render loop at 60 fps while rays march. */
self.onmessage = (event: MessageEvent<ViewshedRequest>) => {
  const req = event.data
  const mask = computeViewshed(
    {
      width: req.width,
      height: req.height,
      cellMeters: req.cellMeters,
      elevation: new Float32Array(req.elevation),
      cls: new Uint8Array(req.cls),
    },
    { col: req.col, row: req.row, eyeHeightM: req.eyeHeightM },
  )
  const response: ViewshedResponse = { requestId: req.requestId, mask }
  ;(self as unknown as Worker).postMessage(response, [mask.buffer as ArrayBuffer])
}
