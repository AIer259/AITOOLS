import { File, FileText, FileType2 } from 'lucide-react'
import type { DocType } from '../../types'

interface DocTypeIconProps {
  docType?: DocType
  size?: number
}

export function DocTypeIcon({ docType, size = 16 }: DocTypeIconProps) {
  if (docType === 'pdf') return <File size={size} />
  if (docType === 'docx') return <FileType2 size={size} />
  return <FileText size={size} />
}
