import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

interface PopupMenuProps {
  items: MenuItem[]
  onClose: () => void
  className?: string
}

export function PopupMenu({ items, onClose, className = '' }: PopupMenuProps) {
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className={`popup-menu ${className}`.trim()} role="menu">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
