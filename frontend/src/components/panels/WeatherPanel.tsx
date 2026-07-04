import { Cloud, CloudRain, Eye, Navigation, Thermometer, Wind } from 'lucide-react'
import { useBattleground } from '../../state/battleground'

/** Right-side live conditions card (Open-Meteo at battlefield center). */
export function WeatherPanel() {
  const meta = useBattleground((s) => s.meta)
  const weather = meta?.weather

  return (
    <div className="glass w-52 rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">FIELD CONDITIONS</div>
      {!weather ? (
        <div className="py-1 text-xs text-(--text-dim)">
          {meta ? 'Weather unavailable for this area' : 'Generate a battlefield for live conditions'}
        </div>
      ) : (
        <dl className="flex flex-col gap-1.5">
          <Row icon={Thermometer} label="Temperature" value={`${weather.temperatureC.toFixed(1)} °C`} />
          <Row
            icon={Wind}
            label="Wind"
            value={`${weather.windSpeedKmh.toFixed(0)} km/h`}
            extra={
              <Navigation
                className="h-3 w-3 text-(--text-dim)"
                style={{ transform: `rotate(${weather.windDirectionDeg + 180}deg)` }}
                strokeWidth={1.75}
              />
            }
          />
          <Row icon={Cloud} label="Cloud cover" value={`${weather.cloudCoverPct.toFixed(0)} %`} />
          <Row icon={CloudRain} label="Precipitation" value={`${weather.precipitationMm.toFixed(1)} mm`} />
          <Row icon={Eye} label="Visibility" value={`${(weather.visibilityM / 1000).toFixed(1)} km`} />
        </dl>
      )}
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value,
  extra,
}: {
  icon: typeof Cloud
  label: string
  value: string
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-(--text-dim)">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <span className="flex items-center gap-1.5 text-(--text-h)">
        {extra}
        {value}
      </span>
    </div>
  )
}
