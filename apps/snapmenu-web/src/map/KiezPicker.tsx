// Map adapted from the team's wohin app (apps/web/src/screens/map/KiezPicker.tsx).
// Area choice for the map: a modal bottom sheet with "Near you" plus every Kiez.
import { useEffect, useRef } from 'react'
import { Icon } from '../components/ui'
import { KIEZE, type Kiez } from './ranking'

/** `value`: a Kiez, null for "Near you", undefined when neither is the current area. */
export function KiezPicker({ open, value, onChange, onClose }: { open: boolean; value: Kiez | null | undefined; onChange: (kiez: Kiez | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const options: Array<{ value: Kiez | null; label: string }> = [{ value: null, label: 'Near you' }, ...KIEZE.map((k) => ({ value: k, label: k }))]

  return (
    <dialog
      ref={ref}
      className="kiez-picker"
      aria-labelledby="kiez-picker-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="kiez-picker__panel">
        <div className="kiez-picker__head">
          <h2 id="kiez-picker-title">Area</h2>
          <button type="button" className="kiez-picker__close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div role="radiogroup" aria-labelledby="kiez-picker-title" className="kiez-picker__list">
          {options.map((o) => {
            const checked = o.value === value
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={checked}
                className="kiez-picker__option"
                onClick={() => {
                  onChange(o.value)
                  onClose()
                }}
              >
                <Icon name={o.value ? 'city' : 'locate'} size={18} />
                <span>{o.label}</span>
                {checked && <Icon name="check" size={18} strokeWidth={2} className="kiez-picker__check" />}
              </button>
            )
          })}
        </div>
      </div>
    </dialog>
  )
}
