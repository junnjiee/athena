import * as Cesium from 'cesium';
import { fetchFeed, statsFromProvenance } from './sgClient.js';

/**
 * Singapore acute hazards — lightning strikes and PUB flood alerts.
 *
 * Both feeds are empty most of the time, and that is the layer's most important
 * property: **an empty hazard feed is healthy, not broken.** Zero strikes is
 * the normal state of the sky. The layer therefore reports `count: 0` with no
 * error, and the server deliberately attaches no health check to these feeds —
 * only feeds with a documented expected size get one.
 *
 * Lightning matters here more than it looks. NEA publishes strike positions on
 * a two-minute cadence with 200 m–2 km accuracy, and the anchor scenario is an
 * open-roof stadium: a strike halo over a venue during egress is a real
 * operational call, not a decoration.
 */

const STRIKE_COLOR = Cesium.Color.fromCssColorString('#8ea2ff');
const FLOOD_COLOR = Cesium.Color.fromCssColorString('#42c9c2');

function createSgHazardLayer() {
  let _dataSource = null;
  let _stats = { count: 0, lastUpdate: null, error: null };
  let _strikes = 0;
  let _floods = 0;

  function addStrike(entities, event, index) {
    entities.add({
      id: `sg-strike-${index}`,
      position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
      point: {
        pixelSize: 9,
        color: STRIKE_COLOR,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      ellipse: {
        semiMinorAxis: 2_000,
        semiMajorAxis: 2_000,
        material: STRIKE_COLOR.withAlpha(0.16),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      description: `<b>Lightning</b><br>${event.kind ?? 'strike'}<br>${event.at ?? ''}`,
    });
  }

  function addFlood(entities, event, index) {
    entities.add({
      id: `sg-flood-${index}`,
      position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
      ellipse: {
        semiMinorAxis: 400,
        semiMajorAxis: 400,
        material: FLOOD_COLOR.withAlpha(0.5),
        outline: true,
        outlineColor: FLOOD_COLOR,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      description: `<b>Flood alert</b><br>${event.text ?? ''}<br>${event.at ?? ''}`,
    });
  }

  const layer = {
    id: 'sg-hazard',
    name: 'SG Hazards (lightning, flood)',
    icon: '⚡',
    source: 'NEA + PUB via data.gov.sg',
    refreshInterval: 2 * 60_000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('sg-hazard');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
    },

    enable() {
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      if (_dataSource) _dataSource.show = false;
    },

    destroy(viewer) {
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _stats = { count: 0, lastUpdate: null, error: null };
    },

    async update(viewer, { signal } = {}) {
      let lightning;
      let flood;
      try {
        [lightning, flood] = await Promise.all([
          fetchFeed('lightning', signal),
          fetchFeed('flood-alerts', signal),
        ]);
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        _stats = { ..._stats, error: 'Athena SG proxy unreachable' };
        console.warn('[Data:SGHazard] fetch failed:', error);
        return false;
      }

      const strikes = lightning?.data?.events ?? [];
      const floods = flood?.data?.events ?? [];
      _strikes = strikes.length;
      _floods = floods.length;

      _dataSource.entities.removeAll();
      strikes.forEach((event, i) => addStrike(_dataSource.entities, event, i));
      floods.forEach((event, i) => addFlood(_dataSource.entities, event, i));

      // Quiet skies are reported as a healthy zero, never as an error.
      _stats = {
        ...statsFromProvenance(lightning?.provenance ?? null, _strikes + _floods),
        strikes: _strikes,
        floodAlerts: _floods,
      };
      return true;
    },

    getAnalystRecords() {
      return [{ kind: 'sg-hazard', strikes: _strikes, floodAlerts: _floods, lastUpdate: _stats.lastUpdate }];
    },

    getStats() {
      return _stats;
    },
  };

  return layer;
}

const sgHazardLayer = createSgHazardLayer();
export default sgHazardLayer;
