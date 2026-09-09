import { useCesium } from 'resium'
import { useRectangleSelection } from '../../hooks/useRectangleSelection'
import type { SelectionResult } from '../../types/selection'

interface Props {
  armed: boolean
  resetToken: number
  maxExtentMeters?: number
  colorHex?: string
  frameOnFinalize?: boolean
  onSelectionFinalize: (result: SelectionResult) => void
}

export function RectangleSelectionController({
  armed,
  resetToken,
  maxExtentMeters,
  colorHex,
  frameOnFinalize,
  onSelectionFinalize,
}: Props) {
  const { viewer } = useCesium()
  useRectangleSelection({
    viewer,
    armed,
    resetToken,
    maxExtentMeters,
    colorHex,
    frameOnFinalize,
    onSelectionFinalize,
  })
  return null
}
