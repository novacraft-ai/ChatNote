import './AppDialog.css'

type Props = {
  open: boolean
  title?: string
  message: string
  onClose: () => void
}

const AppDialog = ({ open, title = 'ChatNote:', message, onClose }: Props) => {
  if (!open) return null

  return (
    <div className="app-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="app-dialog">
        <div className="app-dialog-title">{title}</div>
        <div className="app-dialog-message">{message}</div>
        <div className="app-dialog-actions">
          <button className="app-dialog-ok" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  )
}

export default AppDialog
