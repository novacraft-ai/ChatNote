// No React import required in modern JSX setup; keep file clean
import './AnnotationLayer.css'

interface FloatingTextboxToolbarProps {
  annotation: any
  onUpdate: (annotation: any) => void
  position: { left: number; top: number }
}

export default function FloatingTextboxToolbar({ annotation, onUpdate, position }: FloatingTextboxToolbarProps) {
  return (
    <div className="floating-textbox-toolbar" style={{ left: position.left, top: position.top, position: 'absolute', zIndex: 9999 }}>
      <div className="font-size-group">
        <button className="toolbar-icon" onClick={() => onUpdate({ ...annotation, fontSize: Math.max(1, (annotation.fontSize || 16) - 1) })}>−</button>
        <span className="font-size-display">{annotation.fontSize || 16}</span>
        <button className="toolbar-icon" onClick={() => onUpdate({ ...annotation, fontSize: Math.min(200, (annotation.fontSize || 16) + 1) })}>+</button>
      </div>
      <div className="color-swatch-group">
        {[ '#000000', '#ff0000', '#0000ff', '#00ff00', '#ffeb3b' ].map((color) => (
          <button
            key={color}
            className={`color-swatch ${annotation.color === color ? 'active' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => onUpdate({ ...annotation, color })}
            title={color}
          />
        ))}
      </div>
    </div>
  )
}
