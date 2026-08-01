# Gaussian-splat hero assets

High-fidelity close-range scenes rendered inside RECON (photo) mode on top of the
Google Photorealistic 3D Tiles diorama. These are **our** assets — unlike Google
tiles they are served with immutable cache headers and may be mirrored to disk,
so a warmed demo survives venue Wi-Fi loss.

## Capture → stream workflow

1. **Capture** the objective building/area with a phone: Polycam, Luma, or
   Scaniverse (gaussian-splat mode). Walk a full orbit, two heights.
2. **Preferred path — Cesium ion**: export PLY, upload to Cesium ion. ion tiles
   it into SPZ-compressed 3D Tiles with LOD and streams it from its CDN. Add an
   entry to `index.json` with the ion `assetId` (+ `placement` if the capture
   isn't georeferenced).
3. **Self-hosted path (offline-resilient)**: export a splat `.glb` (e.g. via
   SuperSplat), then:

   ```bash
   bun scripts/wrap-splat.ts --name objective-block --model capture.glb \
     --lon 103.7185 --lat 1.3092 --height 25 --radius 80
   ```

   which writes `<name>/{model.glb,tileset.json}` here and prints the
   `index.json` entry.

## index.json

```json
[
  { "name": "objective-block", "path": "objective-block/tileset.json" },
  {
    "name": "hq-scan",
    "ionAssetId": 1234567,
    "placement": { "lon": 103.7185, "lat": 1.3092, "heightM": 25, "headingDeg": 90, "scale": 1 }
  }
]
```

`placement` re-positions a non-georeferenced tileset at runtime (heading in
degrees clockwise from north, uniform scale). Omit it for assets ion already
georeferenced. Missing `index.json` simply means no hero assets — RECON mode
degrades cleanly to Google tiles only.
