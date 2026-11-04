import { getTreeIndex, type TreeIndex } from '../lib/treeIndex'
import { useNoteStore } from './useNoteStore'

/** 订阅 nodes，并返回随 nodes 引用缓存的只读索引 */
export function useTreeIndex(): TreeIndex {
  const nodes = useNoteStore((state) => state.nodes)
  return getTreeIndex(nodes)
}
