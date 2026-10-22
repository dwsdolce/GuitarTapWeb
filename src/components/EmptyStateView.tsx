// @parity view/empty-state
import type { ReactNode } from 'react'

/** Swift's EmptyStateView: a large icon, a title and a message, centred in the space it is given. */
export function EmptyStateView({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden>
        {icon}
      </span>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-message">{message}</p>
    </div>
  )
}
