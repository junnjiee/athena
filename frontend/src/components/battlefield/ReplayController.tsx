import { useCesium } from 'resium'
import { useReplay } from '../../state/replay'
import { useSoldierEntities } from '../../hooks/useSoldierEntities'

/** Mounted inside the <Viewer> tree (needs `viewer` from useCesium()) while a
 *  replay is loaded -- renders soldiers/shots over the terrain the replay's
 *  battleground was generated against. */
export function ReplayController() {
  const { viewer } = useCesium()
  const run = useReplay((s) => s.run)
  const currentStep = useReplay((s) => s.currentStep)
  const interpolatedT = useReplay((s) => s.interpolatedT)

  useSoldierEntities({
    viewer,
    replay: run?.replay ?? null,
    bbox: run?.meta.bbox ?? null,
    currentStep,
    interpolatedT,
  })

  return null
}
