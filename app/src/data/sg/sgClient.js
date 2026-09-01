/**
 * Client for Athena's Singapore data plane.
 *
 * Every SG layer reads through this and never contacts data.gov.sg or LTA
 * DataMall directly. That is not stylistic: data.gov.sg throttles to 6 requests
 * per 10 seconds without a key, so per-tab fetching would throttle the console
 * the moment two operators opened it. The Athena server owns polling, caching
 * and the quota budget; a layer's `update()` is a cache read.
 *
 * The server's provenance envelope maps straight onto the manager's feed-state
 * chip, so staleness and degradation show up in the existing UI without any
 * per-layer plumbing.
 */

const BASE = '/api/sg';

/**
 * @typedef {object} Provenance
 * @property {string} source
 * @property {string} attribution
 * @property {string} license
 * @property {string|null} fetchedAt
 * @property {string|null} upstreamAt
 * @property {number|null} ageMs
 * @property {number} cadenceMs
 * @property {'live'|'cached'|'stale'|'degraded'|'unavailable'} state
 * @property {string|null} note
 */

/**
 * Fetches one feed. Throws only on transport/HTTP failure — an upstream outage
 * arrives as a 200 with `state: 'unavailable'`, because the layer still needs
 * the attribution and the age of whatever was last known.
 * @param {string} id feed id, e.g. 'rainfall'
 * @param {AbortSignal} [signal]
 * @returns {Promise<{data: any, provenance: Provenance}>}
 */
export async function fetchFeed(id, signal) {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error(`${id} HTTP ${response.status}`);
  return response.json();
}

/** Fetches several feeds concurrently; the server coalesces and caches them. */
export async function fetchFeeds(ids, signal) {
  const results = await Promise.all(ids.map((id) => fetchFeed(id, signal)));
  return Object.fromEntries(ids.map((id, i) => [id, results[i]]));
}

/**
 * Maps a provenance envelope onto the shape `DataLayerManager.getStats()`
 * expects, so the row chip reads OFF / LIVE / UNAVAILABLE correctly and a
 * degraded feed says why.
 *
 * `degraded` is deliberately surfaced through `error`: a thinned feed that
 * renders as normal is the exact failure this project exists to avoid.
 * @param {Provenance|null} provenance
 * @param {number} count rendered record count
 */
export function statsFromProvenance(provenance, count) {
  if (!provenance) return { count, lastUpdate: null, error: null };
  const problem = provenance.state === 'unavailable' || provenance.state === 'degraded';
  return {
    count,
    // GEV's panel does arithmetic on `lastUpdate` (`_timeAgo`), so it must be
    // epoch milliseconds. Passing the ISO string straight through renders
    // "NaNh ago" — caught by running the console, not by any unit test.
    lastUpdate: provenance.fetchedAt ? Date.parse(provenance.fetchedAt) : null,
    status: provenance.state,
    error: problem ? provenance.note : null,
    source: provenance.attribution,
    ageMs: provenance.ageMs,
    fetchedAtIso: provenance.fetchedAt,
  };
}

/** Human age string for labels and cards: "12s", "4m", "2h". */
export function ageLabel(ageMs) {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return '—';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
