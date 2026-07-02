import { useCesium } from 'resium'
import { useRectangleSelection } from '../../hooks/useRectangleSelection'
import type { SelectionResult } from '../../types/selection'

interface Props {
  armed: boolean
  resetToken: number
  onSelectionFinalize: (result: SelectionResult) => void
}

export function RectangleSelectionController({ armed, resetToken, onSelectionFinalize }: Props) {
  const { viewer } = useCesium()
  useRectangleSelection({ viewer, armed, resetToken, onSelectionFinalize })
  return null
}
