import { useEffect, useState } from 'react'
import { padCount } from '../format.js'

export default function NoticeDocuments({ noticeId }) {
  const [documents, setDocuments] = useState([])
  const [state, setState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(`/api/notices/${encodeURIComponent(noticeId)}/documents`)
      .then((response) => {
        if (response.status === 404) return []
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        setDocuments(Array.isArray(data) ? data : [])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [noticeId])

  return (
    <section className="dossier-block documents" aria-labelledby="documents-title">
      <h3 id="documents-title" className="mono">
        Documents / {state === 'ready' ? padCount(documents.length).slice(-2) : '··'}
      </h3>
      {state === 'loading' ? <p className="state-line mono">Loading documents...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load documents.</p> : null}
      {state === 'ready' && documents.length === 0 ? (
        <p className="state-line mono">No downloaded documents.</p>
      ) : null}
      {state === 'ready' && documents.length > 0 ? (
        <ol className="document-list">
          {documents.map((document, index) => (
            <li key={document.url || document.filename}>
              <span className="document-index mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="document-name">{document.filename}</span>
              <a
                className="text-link mono"
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${document.filename}`}
              >
                Open <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
