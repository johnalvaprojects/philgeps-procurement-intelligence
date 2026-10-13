export const LEGACY_ORIGIN = 'https://notices.philgeps.gov.ph'
export const OPEN_LIST_URL = `${LEGACY_ORIGIN}/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?ClickFrom=OpenOpp&Result=3&menuIndex=3`
export const NEXT_PAGE_TARGET = 'pgCtrlDetailedSearch$nextLB'

const BLOCKED = /ViewDocumentRequestList\.aspx|log-in\.aspx|\/login/i
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export function assertPublicLegacyUrl(url) {
  const value = String(url || '')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    const error = new Error('Old PhilGEPS reader refused a request that is not a public notice URL.')
    error.code = 'LEGACY_BLOCKED_URL'
    throw error
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'notices.philgeps.gov.ph' || BLOCKED.test(parsed.pathname + parsed.search)) {
    const error = new Error('Old PhilGEPS reader only requests public pages on notices.philgeps.gov.ph.')
    error.code = 'LEGACY_BLOCKED_URL'
    throw error
  }
  return parsed.toString()
}

export function abstractUrl(referenceId) {
  const id = String(referenceId || '')
  if (!/^\d+$/.test(id)) {
    const error = new Error('Old PhilGEPS reference numbers must be digits.')
    error.code = 'LEGACY_BLOCKED_URL'
    throw error
  }
  const url = new URL('/GEPSNONPILOT/Tender/SplashBidNoticeAbstractUI.aspx', LEGACY_ORIGIN)
  url.searchParams.set('menuIndex', '3')
  url.searchParams.set('refID', id)
  url.searchParams.set('Result', '3')
  return url.toString()
}

export function legacyDelayMs() {
  return Math.max(1500, Number(process.env.REQUEST_DELAY_MS || 1000))
}

function timeoutMs() {
  return Number(process.env.REQUEST_TIMEOUT_MS || 45000)
}

export async function legacyRequest(url, {
  method = 'GET',
  form,
  referer = OPEN_LIST_URL,
  fetchImpl = globalThis.fetch,
  timeout = timeoutMs(),
} = {}) {
  const target = assertPublicLegacyUrl(url)
  const headers = {
    'User-Agent': process.env.USER_AGENT || DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    Referer: referer,
  }
  const init = {
    method,
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  }
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = new URLSearchParams(form).toString()
  }
  const response = await fetchImpl(target, init)
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${target}`)
    error.status = response.status
    throw error
  }
  return { status: response.status, text: await response.text() }
}
