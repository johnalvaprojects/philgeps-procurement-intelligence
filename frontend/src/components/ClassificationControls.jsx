const CHOICES = [
  { label: 'Software', value: 'software', stored: 'software' },
  { label: 'Review', value: 'review', stored: 'review' },
  { label: 'Not Relevant', value: 'not-relevant', stored: 'not relevant' },
]

export default function ClassificationControls({ current, saving, error, onChoose }) {
  return (
    <div className="classify">
      <div className="classify-choices" role="group" aria-label="Set classification">
        {CHOICES.map((choice) => {
          const active = current === choice.stored
          return (
            <button
              key={choice.value}
              type="button"
              className={active ? 'classify-choice mono is-active' : 'classify-choice mono'}
              onClick={() => onChoose(choice.value)}
              disabled={saving || active}
              aria-pressed={active}
            >
              <span aria-hidden="true">[ </span>
              {choice.label}
              <span aria-hidden="true"> ]</span>
            </button>
          )
        })}
      </div>
      <p className="classify-note mono" aria-live="polite">
        {saving ? 'Saving classification...' : error || 'Manual decisions override automatic classification.'}
      </p>
    </div>
  )
}
