import { useEffect, useState } from 'react'

export function useNoticeDocuments(noticeId) {
  const [state, setState] = useState(noticeId ? 'loading' : 'unavailable')
  const [files, setFiles] = useState([])

  useEffect(() => {
    if (!noticeId) {
      setState('unavailable')
      setFiles([])
      return undefined
    }

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
        setFiles(Array.isArray(data) ? data : [])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([])
          setState('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [noticeId])

  return { state, files }
}
