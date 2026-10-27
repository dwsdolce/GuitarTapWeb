// @parity view/export-menus
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { menuPlacement } from './menuPlacement'
import { ChevronDownIcon, MenuItemIcon } from './icons'
import type { ExportMenu } from '../presentation/exportMenus'

/** A button that opens an export menu (exportMenus): its word and icon, and the menu's items with their icons, a
 *  separator between groups — floating above the page as Saved Measurements' menus do, placed against the button
 *  and opening up or down to fit the window. Mirrors Swift's `Menu { ExportMenuItems }`. */
export function ExportMenuButton<Action extends string>({
  menu,
  onChoose,
  disabled,
  title,
  className = 'btn',
}: {
  menu: ExportMenu<Action>
  onChoose: (action: Action) => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    setHeight(rect ? (menuRef.current?.offsetHeight ?? null) : null)
  }, [rect])
  return (
    <>
      <button
        className={className}
        onClick={(e) => {
          // Read now: the event's currentTarget is gone by the time React runs a state updater.
          const at = e.currentTarget.getBoundingClientRect()
          setRect((r) => (r ? null : at))
        }}
        disabled={disabled}
        aria-expanded={rect != null}
        title={title}
      >
        <MenuItemIcon mdi={menu.mdi} />
        <span>{menu.button}</span>
        <ChevronDownIcon />
      </button>
      {rect &&
        createPortal(
          <>
            <div
              className="meas-sort-backdrop"
              onClick={(e) => {
                e.stopPropagation()
                setRect(null)
              }}
            />
            <div
              className="meas-menu"
              role="menu"
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
                ...menuPlacement(rect, height),
              }}
            >
              {menu.groups.map((group, gi) => (
                <Fragment key={gi}>
                  {gi > 0 && <div className="meas-menu-sep" />}
                  {group.map((entry) => (
                    <button
                      key={entry.action}
                      role="menuitem"
                      onClick={() => {
                        setRect(null)
                        onChoose(entry.action)
                      }}
                    >
                      <span className="meas-ico"><MenuItemIcon mdi={entry.mdi} /></span>
                      {entry.title}
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
