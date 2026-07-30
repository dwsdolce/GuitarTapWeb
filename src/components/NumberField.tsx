// @parity view/validated-number-field
// Shared precision-restricted numeric input — the web mirror of Swift `ValidatedNumberField` / Python's
// QLineEdit + `_decimal_validator`. Used by the Settings panel and the Results-panel dimension editors.
//
// A STRING buffer backs the input so an in-progress decimal ("4." → "4.8" → "4.85") survives keystroke to
// keystroke; binding straight to the numeric value rounds "4." back to 4 and erases the dot (the field
// would be integer-only). An over-precise keystroke is rejected (decimalsWithin); the parsed number
// commits live for recompute; on blur the buffer re-syncs to the canonical value.
import { useEffect, useRef, useState } from 'react'
import { FieldPrecision } from '../precision'

export function NumberField({
  label,
  unit,
  value,
  onChange,
  decimals,
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
  decimals: number
}) {
  const [text, setText] = useState<string>(() => String(value))
  const focused = useRef(false)
  // Re-sync from the external value when NOT mid-edit (Reset, Cancel-revert, load / capture-complete).
  useEffect(() => {
    if (!focused.current) setText(String(value))
  }, [value])
  return (
    <label className="set-field">
      <span>{label}</span>
      <span className="set-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onFocus={() => { focused.current = true }}
          onBlur={() => { focused.current = false; setText(String(value)) }}
          onChange={(e) => {
            const s = e.target.value
            if (!FieldPrecision.decimalsWithin(s, decimals)) return // reject over-precise keystroke (revert)
            setText(s) // accept — including the intermediate '', '-', '4.'
            if (s !== '' && s !== '-' && Number.isFinite(Number(s))) {
              onChange(FieldPrecision.rounded(Number(s), decimals))
            }
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  )
}
