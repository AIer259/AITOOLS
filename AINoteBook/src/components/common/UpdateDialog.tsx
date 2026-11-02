import { useEffect } from 'react'

const CHANGELOG_URL =
  'https://github.com/AIer259/AITOOLS/blob/main/AINoteBook/CHANGELOG.md'

interface UpdateDialogProps {
  currentVersion: string
  latestVersion: string
  onUpdate: () => void
  onLater: () => void
}

export function UpdateDialog({
  currentVersion,
  latestVersion,
  onUpdate,
  onLater,
}: UpdateDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLater()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onLater])

  return (
    <div className="dialog-backdrop" onMouseDown={onLater}>
      <div
        className="dialog update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="update-dialog-title">发现新版本</h3>
        <p className="dialog-message">
          当前版本 v{currentVersion}，最新版本 v{latestVersion}。
        </p>
        <p className="dialog-message">
          更新会重新加载页面以加载最新构建，已保存的笔记不受影响。
        </p>
        <a
          className="dialog-link"
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer"
        >
          查看更新日志
        </a>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onLater}>
            稍后
          </button>
          <button type="button" className="btn primary" onClick={onUpdate}>
            立即更新
          </button>
        </div>
      </div>
    </div>
  )
}
