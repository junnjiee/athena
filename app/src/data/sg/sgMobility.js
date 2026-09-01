import * as Cesium from 'cesium';
import { fetchFeed, statsFromProvenance } from './sgClient.js';

/**
 * Singapore mobility — every unhired taxi on the island, refreshed each minute.
 *
 * Roughly two thousand points, which is why this uses a `PointPrimitiveCollection`
 * rather than entities: 2,000 `Entity` billboards rebuild their graphics on every
 * poll and cost far more than the flat primitive buffer, which is updated in
 * place. There is no per-frame work here at all.
 *
 * It reads as a crowd proxy rather than a transport layer. Singapore publishes
 * no live footfall API, and taxi density — where cabs cluster, and where a void
 * opens because roads are shut — is one of the four live signals that actually
 * exist. It is a proxy, and the layer name says so.
 */

const TAXI_COLOR = Cesium.Color.fromCssColorString('#f2c14e').withAlpha(0.92);

function createSgMobilityLayer() {
  let _points = null;
  let _stats = { count: 0, lastUpdate: null, error: null };

  const layer = {
    id: 'sg-mobility',
    name: 'SG Taxis (crowd proxy)',
    icon: '🚕',
    source: 'LTA via data.gov.sg',
    refreshInterval: 60_000,

    init(viewer) {
      _points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      _points.show = false;
    },

    enable() {
      if (_points) _points.show = true;
    },

    disable() {
      if (_points) _points.show = false;
    },

    destroy(viewer) {
      if (_points && !_points.isDestroyed?.()) {
        viewer.scene.primitives.remove(_points);
      }
      _points = null;
      _stats = { count: 0, lastUpdate: null, error: null };
    },

    async update(viewer, { signal } = {}) {
      let feed;
      try {
        feed = await fetchFeed('taxi-availability', signal);
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        _stats = { ..._stats, error: 'Athena SG proxy unreachable' };
        console.warn('[Data:SGMobility] fetch failed:', error);
        return false;
      }

      const taxis = feed?.data?.events ?? [];
      if (!_points) return false;

      _points.removeAll();
      for (const taxi of taxis) {
        _points.add({
          position: Cesium.Cartesian3.fromDegrees(taxi.lon, taxi.lat),
          color: TAXI_COLOR,
          pixelSize: 4,
          // Keep the cloud readable from orbit without swamping street level.
          scaleByDistance: new Cesium.NearFarScalar(2_000, 1.6, 120_000, 0.5),
          translucencyByDistance: new Cesium.NearFarScalar(2_000, 1.0, 400_000, 0.25),
        });
      }

      _stats = statsFromProvenance(feed?.provenance ?? null, taxis.length);
      return true;
    },

    getAnalystRecords() {
      // A point cloud has no per-record identity worth reasoning over; the
      // count and its recency are the whole signal.
      return [{ kind: 'taxi-availability', available: _stats.count, lastUpdate: _stats.lastUpdate }];
    },

    getStats() {
      return _stats;
    },
  };

  return layer;
}

const sgMobilityLayer = createSgMobilityLayer();
export default sgMobilityLayer;
