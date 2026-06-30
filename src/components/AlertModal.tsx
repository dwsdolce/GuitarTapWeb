// A simple modal alert dialog, mirroring the native apps' .alert(...) popups
// (Swift "Microphone Not Connected" / "Microphone Access Required" / "Audio Engine
// Error"). Reuses the Settings/Metrics overlay styling.

export interface AlertButton {
  label: string
  onClick: () => void
  primary?: boolean
}

export function AlertModal({
  title,
  message,
  buttons,
  onDismiss,
}: {
  title: string
  message: string
  buttons: AlertButton[]
  /** Clicking the backdrop dismisses via this (mirrors a cancel/OK). */
  onDismiss: () => void
}) {
  return (
    <div className="settings-overlay" role="alertdialog" aria-label={title} onClick={onDismiss}>
      <div className="settings-modal alert-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="alert-title">{title}</h3>
        <p className="alert-message">{message}</p>
        <div className="alert-buttons">
          {buttons.map((b) => (
            <button key={b.label} className={`btn${b.primary ? ' primary' : ''}`} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}