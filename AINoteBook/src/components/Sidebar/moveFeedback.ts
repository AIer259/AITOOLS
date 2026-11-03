import type { MoveResult } from '../../lib/treeDrag'
import { useUiStore } from '../../store/useUiStore'

export function showMoveResult(result: MoveResult): void {
  if (result === 'conflict') {
    useUiStore.getState().showToast('目标位置已有同名附件文件夹，无法移动', 'error')
  } else if (result === 'invalid') {
    useUiStore.getState().showToast('该位置不能放置此项目', 'error')
  }
}
