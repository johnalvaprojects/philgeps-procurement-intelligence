const CHOICES = [
  { label: 'New', value: 'new' },
  { label: 'In progress', value: 'in-progress' },
  { label: 'Done', value: 'done' },
]

export default function WorkStatusControls({ current, saving, error, onChoose }) {
  return (
    <div className="classify">
      <div className="classify-choices" role="group" aria-label="Set work status">
        {CHOICES.map((choice) => {
          const active = current === choice.value
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
        {saving ? 'Saving work status...' : error || 'Done stays in the record. It leaves the active software list.'}
      </p>
    </div>
  )
}
