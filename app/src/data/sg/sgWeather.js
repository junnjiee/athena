import * as Cesium from 'cesium';
import { fetchFeed, statsFromProvenance } from './sgClient.js';

/**
 * Singapore weather — NEA's rain-gauge network, live.
 *
 * ~88 stations reporting five-minute rainfall totals, drawn as ground discs
 * scaled and coloured by intensity. Wind speed and direction ride along on the
 * same layer so an operator reasoning about smoke or hazmat drift has the
 * bearing without a second toggle.
 *
 * Geometry is STATIC. Ellipse axes and point sizes are plain numbers redefined
 * only when a poll lands — never `CallbackProperty`. GEV measured a 23×
 * frame-cost penalty (32.4 ms → 1.4 ms) for per-frame axes on clamped ground
 * ellipses, and this layer would repeat that mistake at 88 stations.
 */

const RAIN_COLORS = [
  { max: 0.01, color: Cesium.Color.fromCssColorString('#4a5f68') }, // dry
  { max: 0.5, color: Cesium.Color.fromCssColorString('#3d8ec9') },
  { max: 2.0, color: Cesium.Color.fromCssColorString('#2fb37a') },
  { max: 5.0, color: Cesium.Color.fromCssColorString('#d6a12a') },
  { max: Infinity, color: Cesium.Color.fromCssColorString('#d24b32') },
];

function rainColor(mm) {
  const value = typeof mm === 'number' ? mm : 0;
  for (const band of RAIN_COLORS) if (value < band.max) return band.color;
  return RAIN_COLORS[RAIN_COLORS.length - 1].color;
}

/** Dry stations stay small; heavy rain reads at a glance from orbit. */
function rainRadius(mm) {
  const value = typeof mm === 'number' ? mm : 0;
  return 260 + Math.min(1400, value * 420);
}

function createSgWeatherLayer() {
  let _dataSource = null;
  let _stats = { count: 0, lastUpdate: null, error: null };
  let _wind = null;

  const layer = {
    id: 'sg-weather',
    name: 'SG Weather (NEA)',
    icon: '🌧️',
    source: 'NEA via data.gov.sg',
    refreshInterval: 5 * 60_000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('sg-weather');
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
      let rain;
      let windSpeed;
      let windDirection;
      try {
        [rain, windSpeed, windDirection] = await Promise.all([
          fetchFeed('rainfall', signal),
          fetchFeed('wind-speed', signal),
          fetchFeed('wind-direction', signal),
        ]);
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        _stats = { ..._stats, error: 'Athena SG proxy unreachable' };
        console.warn('[Data:SGWeather] fetch failed:', error);
        return false;
      }

      const stations = rain?.data?.stations ?? [];
      _dataSource.entities.removeAll();

      for (const station of stations) {
        const mm = station.value;
        const radius = rainRadius(mm);
        _dataSource.entities.add({
          id: `sg-rain-${station.id}`,
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          ellipse: {
            // Static numbers on purpose — see the module note.
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: rainColor(mm).withAlpha(mm > 0 ? 0.55 : 0.22),
            outline: true,
            outlineColor: rainColor(mm).withAlpha(0.9),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            stationId: station.id,
            stationName: station.name,
            rainfallMm: mm,
          },
          description: `<b>${station.name}</b><br>Rainfall (5 min): ${mm ?? '—'} mm`,
        });
      }

      // Wind is one island-wide readout rather than 17 arrows: at this station
      // density the arrows overlap into noise, and the operator question it
      // answers ("which way is it blowing?") is a single number.
      const speeds = (windSpeed?.data?.stations ?? []).filter((s) => typeof s.value === 'number');
      const bearings = (windDirection?.data?.stations ?? []).filter((s) => typeof s.value === 'number');
      _wind = {
        speedKnots: speeds.length
          ? Math.round((speeds.reduce((sum, s) => sum + s.value, 0) / speeds.length) * 10) / 10
          : null,
        bearingDeg: bearings.length
          ? Math.round(bearings.reduce((sum, s) => sum + s.value, 0) / bearings.length)
          : null,
        stations: speeds.length,
      };

      const wet = stations.filter((s) => typeof s.value === 'number' && s.value > 0).length;
      _stats = {
        ...statsFromProvenance(rain?.provenance ?? null, stations.length),
        raining: wet,
        wind: _wind,
      };
      return true;
    },

    /** Lets the voice/analyst engine answer questions grounded in this layer. */
    getAnalystRecords(maxCount = 200) {
      if (!_dataSource || !_dataSource.show) return [];
      const now = Cesium.JulianDate.now();
      const out = [];
      for (const entity of _dataSource.entities.values) {
        if (out.length >= maxCount) break;
        const p = entity.properties;
        out.push({
          kind: 'rain-gauge',
          station: p?.stationName?.getValue(now) ?? null,
          rainfallMm: p?.rainfallMm?.getValue(now) ?? null,
        });
      }
      if (_wind) out.push({ kind: 'wind', ..._wind });
      return out;
    },

    getStats() {
      return _stats;
    },
  };

  return layer;
}

const sgWeatherLayer = createSgWeatherLayer();
export default sgWeatherLayer;
