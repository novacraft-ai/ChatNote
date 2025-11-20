import { useTheme } from '../contexts/ThemeContext'
import './DriveSyncPrompt.css'

interface DriveSyncPromptProps {
    isOpen: boolean
    onConfirm: () => void
    onCancel: () => void
}

export default function DriveSyncPrompt({ isOpen, onConfirm, onCancel }: DriveSyncPromptProps) {
    const { theme } = useTheme()

    if (!isOpen) return null

    return (
        <div className="drive-sync-backdrop">
            <div className={`drive-sync-modal ${theme}`}>
                <h3>Sync with Google Drive?</h3>
                <p>
                    Would you like to sync your PDFs and notes with Google Drive?
                    This allows you to access your files from any device.
                </p>
                <div className="drive-sync-buttons">
                    <button onClick={onCancel} className="button-cancel">
                        Not Now
                    </button>
                    <button onClick={onConfirm} className="button-confirm">
                        Sync with Drive
                    </button>
                </div>
            </div>
        </div>
    )
}
