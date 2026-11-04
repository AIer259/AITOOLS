import { useEffect, useRef, useState } from 'react'

interface NameDialogProps {
  title: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function NameDialog({
  title,
  defaultValue = '',
  placeholder = '请输入名称',
  confirmText = '确定',
  onConfirm,
  onCancel,
}: NameDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  const submit = () => {
    const next = value.trim()
    if (!next) return
    onConfirm(next)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={!value.trim()}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

interface TypeConfirmDialogProps {
  title: string
  message: string
  expected: string
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}

export function TypeConfirmDialog({
  title,
  message,
  expected,
  confirmText = '确认',
  onConfirm,
  onCancel,
}: TypeConfirmDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const matched = value.trim() === expected

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  const submit = () => {
    if (matched) onConfirm()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>{title}</h3>
        <p className="dialog-message">{message}</p>
        <p className="dialog-expected">
          请输入 <code>{expected}</code> 以确认
        </p>
        <input
          ref={inputRef}
          value={value}
          placeholder={expected}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={submit}
            disabled={!matched}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '删除',
  danger = true,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
