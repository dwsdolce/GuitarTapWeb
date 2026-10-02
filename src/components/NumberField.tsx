// @parity view/validated-number-field
// Shared precision-restricted numeric input — the web member of the validated-number-field mirror
// (Swift `ValidatedNumberField`, Python `ValidatedNumberField`), each a per-platform input adapter over
// the shared `FieldPrecision` precision policy. Used by the Settings panel and the dimension editors.
//
// A STRING buffer backs the input so an in-progress decimal ("4." → "4.8" → "4.85") survives keystroke to
// keystroke; binding straight to the numeric value rounds "4." back to 4 and erases the dot (the field
// would be integer-only). An over-precise keystroke is rejected (decimalsWithin); the parsed number
// commits live for recompute. The buffer is filled with the value at its precision whenever the value
// differs from the number the field reads (Swift `MaterialDimensionsEditor.seedField`).
import { useEffect, useState } from 'react'
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
  const [text, setText] = useState<string>(() => FieldPrecision.string(value, decimals))
  // A value from elsewhere (Reset, Cancel-revert, a load, a completed capture) refills the field; the
  // field's own edits already equal it, so typing is never overwritten.
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : FieldPrecision.string(value, decimals)))
  }, [value, decimals])
  return (
    <label className="set-field">
      <span>{label}</span>
      <span className="set-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
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
