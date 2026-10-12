import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { apiFetch, setCsrfToken } from './api.js'
import App from './App.jsx'
import Welcome from './Welcome.jsx'
import './theme.css'
import './index.css'
import './welcome.css'

function Root() {
  const [session, setSession] = useState({ state: 'loading', role: null, username: null })

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/auth/session')
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        if (body?.authenticated && (body.role === 'guest' || body.role === 'staff')) {
          setCsrfToken(body.csrfToken)
          setSession({
            state: 'ready',
            role: body.role,
            username: body.username || null,
            fullAccess: body.fullAccess === true,
          })
          return
        }
        setCsrfToken(null)
        setSession({ state: 'anonymous', role: null, username: null })
      })
      .catch(() => {
        if (!cancelled) setSession({ state: 'anonymous', role: null, username: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function expired() {
      setCsrfToken(null)
      setSession({ state: 'anonymous', role: null, username: null })
    }
    window.addEventListener('auth:expired', expired)
    return () => window.removeEventListener('auth:expired', expired)
  }, [])

  if (session.state === 'loading') {
    return <p className="welcome-status">Checking session</p>
  }

  if (session.state !== 'ready') {
    return (
      <Welcome
        onSession={(next) => setSession({
          state: 'ready',
          role: next.role,
          username: next.username,
          fullAccess: next.fullAccess === true,
        })}
      />
    )
  }

  return (
    <App
      role={session.role}
      fullAccess={session.fullAccess === true}
      onSignedOut={() => {
        setCsrfToken(null)
        setSession({ state: 'anonymous', role: null, username: null })
      }}
    />
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
