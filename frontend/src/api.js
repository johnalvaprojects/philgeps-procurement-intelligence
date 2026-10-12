let csrfToken = null

export function setCsrfToken(token) {
  csrfToken = token || null
}

export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  const method = String(options.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && csrfToken && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  }).then((response) => {
    const path = String(url)
    const signingIn = path.includes('/api/auth/login')
      || path.includes('/api/auth/guest')
      || path.includes('/api/auth/session')
    if (response.status === 401 && !signingIn) {
      setCsrfToken(null)
      window.dispatchEvent(new Event('auth:expired'))
    }
    return response
  })
}
