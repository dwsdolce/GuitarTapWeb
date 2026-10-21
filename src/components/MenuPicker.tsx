import type { SelectHTMLAttributes } from 'react'
import { UnfoldMoreIcon } from './icons'

/** A menu picker drawn as Swift's: a filled rounded box with the value and a ⌃⌄ at its right. The menu is the
 *  browser's own. */
export function MenuPicker(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="menu-picker">
      <select {...props} />
      <UnfoldMoreIcon />
    </span>
  )
}
