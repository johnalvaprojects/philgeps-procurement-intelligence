import { classificationKind, classificationLabel } from '../format.js'

export default function StatusBadge({ classification, source, arrow = false }) {
  const kind = classificationKind(classification).replaceAll(' ', '-')
  const prefix = source === 'manual' ? 'Manual' : source === 'automatic' ? 'Auto' : null
  return (
    <span className={`tag tag-${kind} mono`}>
      {prefix ? `${prefix} / ` : ''}
      {classificationLabel(classification)}
      {arrow ? <span className="tag-arrow" aria-hidden="true"> ↗</span> : null}
    </span>
  )
}
