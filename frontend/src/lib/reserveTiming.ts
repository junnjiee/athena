import type { ReserveTiming } from '../types/routeStudy'

export function reserveCommencementMinutes(timing?: ReserveTiming): number | null {
  if (timing?.decision_minutes === undefined || timing.readiness_minutes === undefined) return null
  return timing.decision_minutes + timing.readiness_minutes
}

export function reserveTaskCompleteMinutes(
  timing: ReserveTiming | undefined,
  movementSeconds: number,
): number | null {
  const commencement = reserveCommencementMinutes(timing)
  if (commencement === null || timing?.deployment_minutes === undefined) return null
  return commencement + movementSeconds / 60 + timing.deployment_minutes
}

export function formatOperationalOffset(minutes: number): string {
  const rounded = Math.round(minutes)
  if (rounded < 60) return `+${rounded} min`
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return remainder === 0 ? `+${hours} hr` : `+${hours} hr ${remainder} min`
}
