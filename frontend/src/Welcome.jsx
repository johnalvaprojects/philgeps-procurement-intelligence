import { useState } from 'react'
import { apiFetch, setCsrfToken } from './api.js'
import { playChannel } from './channel-transition.js'
import './welcome.css'

export default function Welcome({ onSession }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function accept(body) {
    setCsrfToken(body.csrfToken)
    playChannel(() => {
      onSession({ role: body.role, username: body.username || null, fullAccess: body.fullAccess === true })
    })
  }

  async function continueAsGuest() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const response = await apiFetch('/api/auth/guest', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Unable to continue as guest.')
        return
      }
      accept(body)
    } catch {
      setError('Unable to continue as guest.')
    } finally {
      setPending(false)
    }
  }

  async function signIn(event) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Sign-in failed.')
        return
      }
      accept(body)
    } catch {
      setError('Sign-in failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <p className="welcome-kicker">PhilGEPS / 001</p>
        <h1 className="welcome-title">Welcome</h1>
        <p className="welcome-lede">
          View public procurement notices, or sign in to operate the dashboard.
        </p>
        <button type="button" className="welcome-guest" onClick={continueAsGuest} disabled={pending}>
          Continue as guest
        </button>
        <hr className="welcome-rule" />
        <form onSubmit={signIn}>
          <label className="welcome-label" htmlFor="staff-username">Username</label>
          <input
            id="staff-username"
            className="welcome-input"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label className="welcome-label" htmlFor="staff-password">Password</label>
          <input
            id="staff-password"
            className="welcome-input"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="welcome-error" role="alert">{error}</p> : null}
          <button type="submit" className="welcome-submit" disabled={pending}>
            Sign in
          </button>
        </form>
        <p className="welcome-note">Staff accounts are created for this server.</p>
      </div>
    </main>
  )
}
