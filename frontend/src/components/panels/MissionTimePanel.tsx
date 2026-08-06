import { useEffect, useMemo } from 'react'
import { Clock, Loader2, Moon, Sun, Sunrise, Sunset } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { hourAt, lightFor, useMission } from '../../state/mission'
import { usePlan } from '../../state/plan'

/**
 * Mission window: H-hour, the conditions expected at it, and the day's light.
 *
 * A plan's route estimates give durations; this anchors them to a clock so the
 * commander can see whether the assault lands in daylight (#57). Times are
 * shown in the AO's own timezone, which the forecast reports — planning against
 * the operator's local clock would be actively misleading for a foreign AO.
 */

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" with no zone. */
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function timeOnly(iso: string | null): string {
  if (!iso) return '—'
  // Forecast strings are already AO-local, so render the clock face verbatim
  // rather than re-interpreting through the operator's timezone.
  const t = iso.slice(11, 16)
  return t || '—'
}

export function MissionTimePanel() {
  const phase = useBattleground((s) => s.phase)
  const meta = useBattleground((s) => s.meta)
  const hHour = useMission((s) => s.hHour)
  const setHHour = useMission((s) => s.setHHour)
  const nudgeHHour = useMission((s) => s.nudgeHHour)
  const forecast = useMission((s) => s.forecast)
  const forecastState = useMission((s) => s.forecastState)
  const loadForecast = useMission((s) => s.loadForecast)
  const analysis = useBattleground((s) => s.planAnalysis)
  const routes = usePlan((s) => s.routes)

  const battlegroundId = meta?.id ?? null

  useEffect(() => {
    if (phase === 'ready' && battlegroundId) void loadForecast(battlegroundId)
  }, [phase, battlegroundId, loadForecast])

  const atH = useMemo(() => (hHour === null ? null : hourAt(forecast, hHour)), [forecast, hHour])
  const light = useMemo(() => (hHour === null ? null : lightFor(forecast, hHour)), [forecast, hHour])

  // The plan's own duration, so H+ can be read as an end time.
  const durationMin = analysis?.totalEtaMinutes ?? 0
  const endsAt = hHour !== null && durationMin > 0 ? hHour + durationMin * 60_000 : null
  const atEnd = endsAt === null ? null : hourAt(forecast, endsAt)

  if (phase !== 'ready') return null

  return (
    <div className="glass w-64 rounded-xl p-3">
      <div className="mb-2 flex items-center gap-2 text-xs tracking-wide text-(--text-dim)">
        <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
        MISSION WINDOW
        {forecastState === 'loading' && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin" strokeWidth={2} />
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={hHour === null ? '' : toLocalInput(hHour)}
          onChange={(e) => {
            const v = e.target.value
            setHHour(v === '' ? null : new Date(v).getTime())
          }}
          aria-label="H-hour"
          className="w-full rounded-md border border-(--border) bg-black/20 px-2 py-1 text-xs text-(--text-h) focus:border-(--border-strong) focus:outline-none"
        />
      </div>

      {hHour === null ? (
        <p className="mt-2 text-xs leading-relaxed text-(--text-dim)">
          Set H-hour to see the conditions the plan actually runs in.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-1">
            {[-60, -15, +15, +60].map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => nudgeHHour(minutes)}
                className="flex-1 rounded-md bg-black/20 py-1 text-[10px] text-(--text-dim) transition-colors hover:text-(--text-h)"
              >
                {minutes > 0 ? `+${minutes}` : minutes}
              </button>
            ))}
          </div>

          {forecastState === 'error' && (
            <p className="mt-2 text-xs text-(--text-dim)">
              Forecast unavailable — H-hour is still recorded on the plan.
            </p>
          )}

          {atH && (
            <div className="mt-3 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-(--text-dim)">
                  {atH.isDay ? (
                    <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  At H-hour
                </span>
                <span className="text-(--text-h)">
                  {Math.round(atH.temperatureC)}° · {atH.cloudCoverPct}% cloud
                </span>
              </div>

              {atH.precipitationMm > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-(--text-dim)">Precipitation</span>
                  <span className="text-(--text-h)">{atH.precipitationMm} mm</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-(--text-dim)">Visibility</span>
                <span className="text-(--text-h)">{(atH.visibilityM / 1000).toFixed(1)} km</span>
              </div>

              {atEnd && routes.length > 0 && (
                <div className="flex items-center justify-between border-t border-(--border) pt-1.5">
                  <span className="flex items-center gap-1.5 text-(--text-dim)">
                    {atEnd.isDay ? (
                      <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
                    ) : (
                      <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    At objective (H+{Math.round(durationMin)}m)
                  </span>
                  <span className="text-(--text-h)">{atEnd.isDay ? 'daylight' : 'darkness'}</span>
                </div>
              )}
            </div>
          )}

          {light && (
            <div className="mt-2 flex items-center justify-between border-t border-(--border) pt-2 text-xs text-(--text-dim)">
              <span className="flex items-center gap-1">
                <Sunrise className="h-3.5 w-3.5" strokeWidth={1.75} />
                {timeOnly(light.sunrise)}
              </span>
              <span className="flex items-center gap-1">
                <Sunset className="h-3.5 w-3.5" strokeWidth={1.75} />
                {timeOnly(light.sunset)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
