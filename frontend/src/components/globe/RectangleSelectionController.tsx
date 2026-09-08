import { useCesium } from 'resium'
import { useRectangleSelection } from '../../hooks/useRectangleSelection'
import type { SelectionResult } from '../../types/selection'

interface Props {
  armed: boolean
  resetToken: number
  maxExtentMeters?: number
  onSelectionFinalize: (result: SelectionResult) => void
}

export function RectangleSelectionController({ armed, resetToken, maxExtentMeters, onSelectionFinalize }: Props) {
  const { viewer } = useCesium()
  useRectangleSelection({ viewer, armed, resetToken, maxExtentMeters, onSelectionFinalize })
  return null
}
