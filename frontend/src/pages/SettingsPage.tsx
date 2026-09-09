import { useEffect, useState } from 'react'
import { Check, Loader2, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { WEIGHT_HINT, WEIGHT_KEYS, WEIGHT_LABEL, weightBias } from '../lib/courses'
import { useRouteStudy } from '../state/routeStudy'
import { useSettings, type DefaultLoadPreset } from '../state/settings'
import { LOAD_PRESETS, MOVEMENT_ORDER, MOVEMENT_PROFILES } from '../types/movement'

/** What the server reports about its own configuration — booleans only, never
 *  key material (see server/src/routes/assistant.ts). */
interface IntegrationStatus {
  database: boolean
  elevenLabsKey: boolean
  elevenLabsAgent: boolean
  agentId: string | null
}

type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: IntegrationStatus }
  | { kind: 'error'; message: string }

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm tracking-wide text-(--text-h)">{title}</h2>
        {hint && <p className="text-xs text-(--text-dim)">{hint}</p>}
      </div>
      <div className="glass flex flex-col gap-3 rounded-xl p-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm text-(--text)">{label}</div>
        {hint && <div className="text-xs text-(--text-dim)">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function StatusPill({ ok, okLabel, offLabel }: { ok: boolean; okLabel: string; offLabel: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
        ok ? 'bg-(--accent)/15 text-(--accent)' : 'bg-white/5 text-(--text-dim)'
      }`}
    >
      {ok ? <Check className="h-3 w-3" strokeWidth={2} /> : <X className="h-3 w-3" strokeWidth={2} />}
      {ok ? okLabel : offLabel}
    </span>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-(--accent)' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4.5' : 'left-0.5'}`}
      />
    </button>
  )
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-black/20 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === option.value
              ? 'bg-white/10 text-(--text-h)'
              : 'text-(--text-dim) hover:text-(--text)'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** One learned weight, named in words rather than charted. A ranking nobody
 *  can read is one nobody should trust. */
function WeightRow({ name, weight }: { name: (typeof WEIGHT_KEYS)[number]; weight: number }) {
  const bias = weightBias(weight)
  return (
    <Row label={WEIGHT_LABEL[name]} hint={WEIGHT_HINT[name]}>
      <span
        className={`text-xs ${
          bias === 'neutral'
            ? 'text-(--text-dim)'
            : bias === 'favours'
              ? 'text-(--accent)'
              : 'text-amber-300'
        }`}
      >
        {bias === 'neutral' ? 'Neutral' : bias === 'favours' ? 'Favoured' : 'Discounted'}
      </span>
      <span className="w-10 text-right text-xs tabular-nums text-(--text-h)">
        {weight.toFixed(2)}
      </span>
    </Row>
  )
}

export function SettingsPage() {
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'loading' })
  const settings = useSettings()
  const preferences = useRouteStudy((state) => state.preferences)
  const loadPreferences = useRouteStudy((state) => state.loadPreferences)
  const forgetPreferences = useRouteStudy((state) => state.forgetPreferences)

  useEffect(() => {
    void loadPreferences()
  }, [loadPreferences])

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as IntegrationStatus
      })
      .then((status) => {
        if (!cancelled) setStatusState({ kind: 'ready', status })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatusState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'could not reach the Athena service',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cesiumConfigured = Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN)
  const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_MAPS_KEY)

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className="absolute top-4 right-4 bottom-4 left-60">
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
              <SettingsIcon className="h-4 w-4" strokeWidth={1.75} />
              SETTINGS
            </div>
            <button
              type="button"
              onClick={settings.resetToDefaults}
              className="flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Reset to defaults
            </button>
          </div>

          <div className="flex max-w-2xl flex-col gap-6 overflow-y-auto pr-2">
            <Section
              title="INTEGRATIONS"
              hint="Configured through environment files — see frontend/.env.example and server/.env.example."
            >
              {statusState.kind === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-(--text-dim)">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Checking…
                </div>
              )}

              {statusState.kind === 'error' && (
                <div className="text-sm text-(--hostile)">
                  Couldn't reach the Athena service: {statusState.message}
                </div>
              )}

              {statusState.kind === 'ready' && (
                <>
                  <Row label="Terrain database" hint="Neon Postgres — stores saved plans">
                    <StatusPill
                      ok={statusState.status.database}
                      okLabel="Connected"
                      offLabel="DATABASE_URL unset"
                    />
                  </Row>
                  <Row label="Voice assistant key" hint="ElevenLabs API key, server-side only">
                    <StatusPill
                      ok={statusState.status.elevenLabsKey}
                      okLabel="Configured"
                      offLabel="ELEVENLABS_API_KEY unset"
                    />
                  </Row>
                  <Row
                    label="Voice assistant agent"
                    hint={
                      statusState.status.elevenLabsAgent
                        ? `Agent ${statusState.status.agentId}`
                        : 'Run `bun run agent:sync` in server/ to create it'
                    }
                  >
                    <StatusPill
                      ok={statusState.status.elevenLabsAgent}
                      okLabel="Synced"
                      offLabel="Not created"
                    />
                  </Row>
                </>
              )}

              <Row label="Cesium ion token" hint="World terrain and satellite imagery">
                <StatusPill ok={cesiumConfigured} okLabel="Configured" offLabel="Using demo token" />
              </Row>
              <Row label="Google Map Tiles key" hint="Powers photorealistic RECON mode">
                <StatusPill ok={googleConfigured} okLabel="Configured" offLabel="Not set" />
              </Row>
            </Section>

            <Section
              title="PLANNING DEFAULTS"
              hint="Applied to newly drawn routes. Existing routes keep what they were drawn with."
            >
              <Row label="Movement gait">
                <Choice
                  value={settings.defaultMovementType}
                  onChange={settings.setDefaultMovementType}
                  options={MOVEMENT_ORDER.map((type) => ({
                    value: type,
                    label: MOVEMENT_PROFILES[type].label,
                    title: MOVEMENT_PROFILES[type].blurb,
                  }))}
                />
              </Row>
              <Row label="Carried load">
                <Choice
                  value={settings.defaultLoadPreset}
                  onChange={settings.setDefaultLoadPreset}
                  options={(Object.keys(LOAD_PRESETS) as DefaultLoadPreset[]).map((preset) => ({
                    value: preset,
                    label: LOAD_PRESETS[preset].label,
                    title: `${LOAD_PRESETS[preset].fullLabel} — ${LOAD_PRESETS[preset].loadMassKg} kg`,
                  }))}
                />
              </Row>
              <Row label="Soldier body mass" hint="Drives the metabolic cost estimate">
                <input
                  type="number"
                  min={40}
                  max={150}
                  value={settings.bodyMassKg}
                  onChange={(e) => settings.setBodyMassKg(Number(e.target.value))}
                  className="w-20 rounded-md border border-(--border) bg-black/20 px-2 py-1 text-right text-xs text-(--text-h) focus:border-(--border-strong) focus:outline-none"
                />
                <span className="text-xs text-(--text-dim)">kg</span>
              </Row>
            </Section>

            <Section title="DISPLAY">
              <Row label="Grid references in MGRS" hint="Otherwise decimal degrees">
                <Toggle on={settings.useMGRS} onChange={settings.setUseMGRS} />
              </Row>
              <Row label="Night overlay by default" hint="Applied when a battlefield is generated">
                <Toggle on={settings.nightByDefault} onChange={settings.setNightByDefault} />
              </Row>
            </Section>

            <Section
              title="LEARNED RANKING"
              hint="Shaped by the verdicts given on enemy courses of action. One deployment's taste, not doctrine — reset it when the commander being served changes."
            >
              {!preferences && (
                <div className="text-sm text-(--text-dim)">
                  No ranking read back from the service yet.
                </div>
              )}
              {preferences && (
                <>
                  <Row
                    label="Verdicts recorded"
                    hint={
                      preferences.verdicts === 0
                        ? 'Nothing learned — courses come back in doctrinal order'
                        : 'The history is kept even when the weights are reset'
                    }
                  >
                    <span className="text-xs tabular-nums text-(--text-h)">
                      {preferences.verdicts}
                    </span>
                  </Row>
                  {WEIGHT_KEYS.map((name) => (
                    <WeightRow key={name} name={name} weight={preferences.weights[name]} />
                  ))}
                  <Row label="Forget what was learned" hint="Returns every weight to neutral">
                    <button
                      type="button"
                      onClick={() => void forgetPreferences()}
                      className="flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-xs text-(--text) transition-colors hover:border-(--hostile)/40 hover:text-(--hostile)"
                    >
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Reset ranking
                    </button>
                  </Row>
                </>
              )}
            </Section>

            <Section title="ASSISTANT">
              <Row label="Show the voice assistant" hint="The mic dock on the battleground map">
                <Toggle on={settings.assistantEnabled} onChange={settings.setAssistantEnabled} />
              </Row>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
