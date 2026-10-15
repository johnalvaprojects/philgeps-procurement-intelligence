import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExpandingPanel from './components/ExpandingPanel.jsx'
import Footer from './components/Footer.jsx'
import FeaturedOpportunities from './components/FeaturedOpportunities.jsx'
import Header from './components/Header.jsx'
import Hero from './components/Hero.jsx'
import NoticeDetails from './components/NoticeDetails.jsx'
import NoticeFilters from './components/NoticeFilters.jsx'
import OpportunityList from './components/OpportunityList.jsx'
import OpportunityPager from './components/OpportunityPager.jsx'
import Statistics from './components/Statistics.jsx'
import Awards from '../../archive/merchant-awards/frontend/Awards.jsx'
import MerchantDesk from '../../archive/merchant-awards/frontend/MerchantDesk.jsx'
import { featureEnabled } from '../../config/features.js'
import ScanReports from './reports/ScanReports.jsx'
import AwardedToUs from './components/CompanyAwards.jsx'
import { padCount } from './format.js'
import {
  countClassifications,
  featuredNotices,
  filterNotices,
  noticesInPublishedRange,
  sortNotices,
} from './notices.js'
import { formatScanRangeLabel, validateScanRange } from './scan-range.js'
import { parseLegacyPageLimit } from './scan-portal.js'
import { prefersReducedMotion } from './useReducedMotion.js'
import { playPeel } from './peel-transition.js'
import { playSlideBack } from './slide-over-transition.js'
import { apiFetch, setCsrfToken } from './api.js'
import './App.css'

const EMPTY_COUNTS = { all: 0, software: 0, review: 0, notRelevant: 0 }
const FEATURED_LIMIT = 5
const DEFAULT_PAGE_SIZE = 25
const awardsEnabled = featureEnabled('awards')
const merchantEnabled = featureEnabled('merchant')

function archivedDirectView(view) {
  if (view === 'awards' && !awardsEnabled) return true
  if (view === 'merchant' && !merchantEnabled) return true
  return false
}

function openSection(view, staff) {
  if (archivedDirectView(view)) return 'notices'
  if (awardsEnabled && view === 'awards') return 'awards'
  if (merchantEnabled && staff && view === 'merchant') return 'merchant'
  if (staff && view === 'weekly') return 'reports'
  return 'notices'
}

function plainRect(rect) {
  if (!rect) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export default function App({ role = 'staff', fullAccess = false, onSignedOut }) {
  const staff = role === 'staff' || fullAccess
  const companyAwards = staff
  const [online, setOnline] = useState(null)
  const [notices, setNotices] = useState([])
  const [noticesState, setNoticesState] = useState('loading')
  const [query, setQuery] = useState('')
  const [classification, setClassification] = useState('all')
  const [portal, setPortal] = useState('all')
  const [workStatus, setWorkStatus] = useState('active')
  const [publishedFrom, setPublishedFrom] = useState('')
  const [publishedTo, setPublishedTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanFrom, setScanFrom] = useState('')
  const [scanTo, setScanTo] = useState('')
  const [scanPortal, setScanPortal] = useState('current')
  const [pageLimit, setPageLimit] = useState(1)
  const [activeScanRange, setActiveScanRange] = useState(null)
  const [selected, setSelected] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [section, setSection] = useState(() => openSection(new URLSearchParams(window.location.search).get('view'), staff))
  const [awardRevision, setAwardRevision] = useState(0)
  const wasScanning = useRef(false)
  const originElement = useRef(null)

  const loadNotices = useCallback(async () => {
    setNoticesState('loading')
    try {
      const response = await apiFetch('/api/notices')
      if (!response.ok) throw new Error('Unable to load notices')
      const body = await response.json()
      setNotices(Array.isArray(body) ? body : [])
      setNoticesState('ready')
    } catch {
      setNoticesState('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    apiFetch('/api/status')
      .then((response) => {
        if (!response.ok) throw new Error('Backend status request failed')
        return response.json()
      })
      .then((body) => {
        if (!cancelled) setOnline(body?.status === 'ok')
      })
      .catch(() => {
        if (!cancelled) setOnline(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!staff) return undefined

    apiFetch('/api/scan/status')
      .then((response) => {
        if (!response.ok) throw new Error('Scan status request failed')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        if (body?.running === true) {
          setScanning(true)
          if (body.portal === 'legacy') {
            setScanPortal('legacy')
            if (body.pageLimit) setPageLimit(body.pageLimit)
          } else if (body.from && body.to) {
            setActiveScanRange({ from: body.from, to: body.to })
          }
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [staff])

  useEffect(() => {
    loadNotices()
  }, [loadNotices])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const view = params.get('view')
    if (!archivedDirectView(view)) return
    params.delete('view')
    const query = params.toString()
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', next)
  }, [])

  useEffect(() => {
    if (!scanning) return undefined
    let stopped = false

    const timer = setInterval(async () => {
      try {
        const response = await apiFetch('/api/scan/status')
        if (!response.ok) return
        const body = await response.json()
        if (stopped) return
        if (body?.running !== true) {
          setScanning(false)
          setActiveScanRange(null)
          return
        }
        if (body.portal !== 'legacy' && body.from && body.to) {
          setActiveScanRange({ from: body.from, to: body.to })
        }
      } catch {
        // Keep the current state and try again on the next poll.
      }
    }, 3000)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [scanning])

  useEffect(() => {
    if (scanning) {
      wasScanning.current = true
      return
    }
    if (!wasScanning.current) return
    wasScanning.current = false
    setScanError('')
    setActiveScanRange(null)
    loadNotices()
  }, [scanning, loadNotices])

  async function startScan() {
    if (scanning) return
    setScanError('')
    if (scanPortal === 'legacy') {
      const validation = parseLegacyPageLimit(pageLimit)
      if (!validation.ok) {
        setScanError(validation.error)
        return
      }
      try {
        const response = await apiFetch('/api/scan/legacy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageLimit: validation.pageLimit }),
        })
        if (response.status === 202 || response.status === 409) {
          setScanning(true)
          setActiveScanRange(null)
          return
        }
        if (response.status === 400) {
          const body = await response.json().catch(() => ({}))
          setScanError(body?.error || 'Old PhilGEPS page limit must be a whole number from 1 to 5.')
          return
        }
        setScanError('Unable to start the scan.')
      } catch {
        setScanError('Unable to start the scan.')
      }
      return
    }
    const validation = validateScanRange(scanFrom, scanTo)
    if (!validation.ok) {
      setScanError(validation.error)
      return
    }

    try {
      const headers = validation.payload
        ? { 'Content-Type': 'application/json' }
        : undefined
      const response = await apiFetch('/api/scan', {
        method: 'POST',
        headers,
        body: validation.payload ? JSON.stringify(validation.payload) : undefined,
      })
      if (response.status === 202) {
        const body = await response.json().catch(() => ({}))
        setScanning(true)
        if (body?.from && body?.to) {
          setActiveScanRange({ from: body.from, to: body.to })
        } else {
          setActiveScanRange(null)
        }
        return
      }
      if (response.status === 409) {
        setScanning(true)
        return
      }
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}))
        setScanError(body?.error || 'Invalid scan date range.')
        return
      }
      setScanError('Unable to start the scan.')
    } catch {
      setScanError('Unable to start the scan.')
    }
  }

  function clearScanRange() {
    setScanFrom('')
    setScanTo('')
    setScanError('')
  }

  function applyClassification(updated) {
    const reference = updated?.notice?.referenceNumber ?? updated?.referenceNumber
    setNotices((current) => current.map((notice) => {
      const sameStorage = notice.storageId && String(notice.storageId) === String(selected)
      const sameReference = !notice.storageId && String(notice.referenceNumber) === String(reference)
      if (!sameStorage && !sameReference) return notice
      return {
        ...notice,
        classification: updated.classification,
        classificationSource: updated.classificationSource,
        reviewed: updated.reviewed,
        workStatus: updated.workStatus ?? notice.workStatus,
      }
    }))
  }

  function openNotice(id, element) {
    const shouldRestore = notices.some((notice) => (
      String(notice.storageId || notice.referenceNumber) === String(id) && notice.unread === true
    ))
    if (shouldRestore) {
      setNotices((current) => current.map((notice) => (
        String(notice.storageId || notice.referenceNumber) === String(id)
          ? { ...notice, unread: false }
          : notice
      )))
    }
    if (id) {
      apiFetch(`/api/notices/${encodeURIComponent(id)}/read`, { method: 'POST' })
        .then((response) => {
          if (response.ok || !shouldRestore) return
          setNotices((current) => current.map((notice) => (
            String(notice.storageId || notice.referenceNumber) === String(id)
              ? { ...notice, unread: true }
              : notice
          )))
        })
        .catch(() => {
          if (!shouldRestore) return
          setNotices((current) => current.map((notice) => (
            String(notice.storageId || notice.referenceNumber) === String(id)
              ? { ...notice, unread: true }
              : notice
          )))
        })
    }
    playPeel('forward', () => {
      originElement.current = element || null
      setSelected({
        id,
        rect: plainRect(element?.getBoundingClientRect()),
        instant: !prefersReducedMotion(),
      })
      setPanelOpen(true)
    })
  }

  const requestClose = useCallback(() => {
    playSlideBack(() => {
      setPanelOpen(false)
      setSelected(null)
      const element = originElement.current
      originElement.current = null
      if (element && typeof element.focus === 'function') element.focus({ preventScroll: true })
    })
  }, [])

  const handleClosed = useCallback(() => {
    setSelected(null)
    const element = originElement.current
    originElement.current = null
    if (element && typeof element.focus === 'function') element.focus({ preventScroll: true })
  }, [])

  function updateQuery(value) {
    setQuery(value)
    setPage(1)
  }

  function setClassificationFilter(value) {
    if (value !== classification) setPage(1)
    setClassification(value)
  }

  function updateClassification(value) {
    if (value === classification) return
    playPeel('forward', () => setClassificationFilter(value))
  }

  function updateWorkStatus(value) {
    const next = value === workStatus ? 'active' : value
    if (next !== workStatus) setPage(1)
    setWorkStatus(next)
  }

  function updatePublishedFrom(value) {
    if (value !== publishedFrom) setPage(1)
    setPublishedFrom(value)
  }

  function updatePublishedTo(value) {
    if (value !== publishedTo) setPage(1)
    setPublishedTo(value)
  }

  function clearPublishedDates() {
    if (!publishedFrom && !publishedTo) return
    setPublishedFrom('')
    setPublishedTo('')
    setPage(1)
  }

  function updatePageSize(size) {
    if (size === pageSize) return
    setPageSize(size)
    setPage(1)
  }

  function showOpportunities(filter, { scrollTo = 'list', peel = true } = {}) {
    const leavingDesk = section === 'reports' || section === 'awarded'
    const classChange = Boolean(filter) && filter !== classification
    const sectionChange = section !== 'notices'
    const target = scrollTo === 'featured' ? 'featured' : 'opportunities'
    const go = () => {
      setSection('notices')
      if (filter) setClassificationFilter(filter)
    }
    if (sectionChange || classChange) {
      if (leavingDesk) playSlideBack(go, () => scrollToId(target, 'auto'))
      else if (peel) playPeel('forward', go, () => scrollToId(target, 'auto'))
      else {
        go()
        scrollToId(target)
      }
      return
    }
    scrollToId(target)
  }

  const dateScopedNotices = useMemo(
    () => noticesInPublishedRange(notices, publishedFrom, publishedTo, portal),
    [notices, publishedFrom, publishedTo, portal],
  )
  const counts = noticesState === 'ready' ? countClassifications(dateScopedNotices) : EMPTY_COUNTS
  const visibleNotices = useMemo(
    () => filterNotices(sortNotices(notices), {
      query,
      classification,
      workStatus,
      publishedFrom,
      publishedTo,
      portal,
    }),
    [notices, query, classification, workStatus, publishedFrom, publishedTo, portal],
  )
  const pageCount = Math.max(1, Math.ceil(visibleNotices.length / pageSize) || 1)
  const currentPage = Math.min(page, pageCount)
  const pageNotices = visibleNotices.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const featured = useMemo(
    () => featuredNotices(dateScopedNotices, classification, FEATURED_LIMIT),
    [dateScopedNotices, classification],
  )
  const featuredTotal = {
    all: counts.all,
    software: counts.software,
    review: counts.review,
    'not relevant': counts.notRelevant,
  }[classification] ?? counts.software

  async function signOut() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // The local session still ends if the server is unreachable.
    }
    setCsrfToken(null)
    onSignedOut?.()
  }

  function scrollToId(id, behavior) {
    document.getElementById(id)?.scrollIntoView({
      behavior: behavior || (prefersReducedMotion() ? 'auto' : 'smooth'),
      block: 'start',
    })
  }

  function scrollToOpportunities() {
    scrollToId('opportunities')
  }

  function goToPage(next) {
    const target = Math.min(Math.max(1, next), pageCount)
    if (target === currentPage) return
    setPage(target)
    scrollToOpportunities()
  }

  return (
    <>
      <div className={`${selected ? 'site is-receded' : 'site'}${section === 'reports' ? ' is-reports' : ''}${section === 'awarded' && companyAwards ? ' is-awarded' : ''}${section === 'awards' ? ' is-awards' : ''}${section === 'merchant' && staff ? ' is-merchant' : ''}`} aria-hidden={selected ? 'true' : undefined}>
        <div className="page-sheet" id="top">
        <Header
          online={online}
          scanning={scanning}
          scanRangeLabel={scanning && scanPortal === 'legacy'
            ? `Old PhilGEPS / ${pageLimit} ${pageLimit === 1 ? 'page' : 'pages'}`
            : activeScanRange
              ? formatScanRangeLabel(activeScanRange.from, activeScanRange.to)
              : ''}
          onShowOpportunities={() => showOpportunities()}
          onShowSoftware={staff ? () => showOpportunities('software') : null}
          onShowAwards={awardsEnabled ? () => setSection('awards') : null}
          onShowMerchant={merchantEnabled && staff ? () => setSection('merchant') : null}
          onShowAwarded={companyAwards ? () => {
            if (section === 'awarded') return
            playPeel('forward', () => setSection('awarded'), () => {
              window.scrollTo({ top: 0, behavior: 'auto' })
            })
          } : null}
          onShowReports={staff ? () => {
            if (section === 'reports') return
            playPeel('forward', () => setSection('reports'), () => {
              window.scrollTo({ top: 0, behavior: 'auto' })
            })
          } : null}
          onSignOut={signOut}
        />
        <main>
          {section === 'reports' && staff ? (
            <ScanReports onClose={() => playSlideBack(() => setSection('notices'))} />
          ) : section === 'awarded' && companyAwards ? (
            <AwardedToUs
              revision={awardRevision}
              onClose={() => playSlideBack(() => setSection('notices'))}
            />
          ) : awardsEnabled && section === 'awards' ? (
            <Awards staff={staff} />
          ) : merchantEnabled && section === 'merchant' && staff ? (
            <MerchantDesk />
          ) : (
          <>
          <Hero
            total={staff ? counts.software : counts.all}
            state={noticesState}
            scanning={scanning}
            scanError={scanError}
            scanFrom={scanFrom}
            scanTo={scanTo}
            onScanFromChange={setScanFrom}
            onScanToChange={setScanTo}
            onClearScanRange={clearScanRange}
            onScan={startScan}
            scanPortal={scanPortal}
            onScanPortal={setScanPortal}
            pageLimit={pageLimit}
            onPageLimit={setPageLimit}
            showScan={staff}
            lede={staff
              ? undefined
              : 'Public procurement notices saved from PhilGEPS. Sign in to scan, review, and open reports.'}
          />
          {staff ? (
            <Statistics
              counts={counts}
              active={classification}
              onSelect={(filter) => showOpportunities(filter, { scrollTo: 'featured', peel: false })}
            />
          ) : null}
          {staff ? <FeaturedOpportunities
            notices={featured}
            total={featuredTotal}
            state={noticesState}
            category={classification}
            onOpen={openNotice}
            onViewAll={() => showOpportunities(classification)}
          /> : null}
          <section id="opportunities" className="opportunities" aria-labelledby="opportunities-title">
            <div className="section-rule opportunities-rule">
              <h2 id="opportunities-title" className="opportunities-heading">
                <span className="mono">All notices</span>
                <span className="opportunities-slash mono" aria-hidden="true">/</span>
                <span className="opportunities-count display">
                  {noticesState === 'ready' ? padCount(visibleNotices.length) : '···'}
                </span>
              </h2>
            </div>
            <NoticeFilters
              query={query}
              onQueryChange={updateQuery}
              active={classification}
              onSelect={updateClassification}
              portal={portal}
              onPortal={(value) => {
                setPortal(value)
                setPage(1)
              }}
              workStatus={workStatus}
              onWorkStatus={updateWorkStatus}
              publishedFrom={publishedFrom}
              publishedTo={publishedTo}
              onPublishedFromChange={updatePublishedFrom}
              onPublishedToChange={updatePublishedTo}
              onClearPublishedDates={clearPublishedDates}
              showClassification={staff}
            />
            <OpportunityList
              notices={pageNotices}
              state={noticesState}
              onOpen={openNotice}
              showStatus={staff}
            />
            {noticesState === 'ready' ? (
              <OpportunityPager
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
                total={visibleNotices.length}
                onPageChange={goToPage}
                onPageSizeChange={updatePageSize}
              />
            ) : null}
          </section>
          </>
          )}
          {section === 'reports' && staff || section === 'awarded' && companyAwards || section === 'awards' || (section === 'merchant' && staff) ? null : <div className="footer-reveal-sentinel" aria-hidden="true" />}
        </main>
        </div>
        {section === 'reports' && staff || section === 'awarded' && companyAwards || section === 'awards' || (section === 'merchant' && staff) ? null : <Footer />}
      </div>

      {selected ? (
        <ExpandingPanel
          key={selected.id}
          originRect={selected.rect}
          instant={selected.instant}
          open={panelOpen}
          onRequestClose={requestClose}
          onClosed={handleClosed}
          label={`Notice ${selected.id}`}
        >
          <NoticeDetails
            noticeId={selected.id}
            onBack={requestClose}
            onClassified={applyClassification}
            staff={staff}
            companyAwards={companyAwards}
            onAwardChanged={() => setAwardRevision((value) => value + 1)}
          />
        </ExpandingPanel>
      ) : null}
    </>
  )
}
