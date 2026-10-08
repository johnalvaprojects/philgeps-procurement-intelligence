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
import ScanReports from './reports/ScanReports.jsx'
import { padCount } from './format.js'
import {
  countClassifications,
  featuredNotices,
  filterNotices,
  noticesInPublishedRange,
  sortNotices,
} from './notices.js'
import { formatScanRangeLabel, validateScanRange } from './scan-range.js'
import { prefersReducedMotion } from './useReducedMotion.js'
import './App.css'

const EMPTY_COUNTS = { all: 0, software: 0, review: 0, notRelevant: 0 }
const FEATURED_LIMIT = 5
const DEFAULT_PAGE_SIZE = 25

function plainRect(rect) {
  if (!rect) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export default function App() {
  const [online, setOnline] = useState(null)
  const [notices, setNotices] = useState([])
  const [noticesState, setNoticesState] = useState('loading')
  const [query, setQuery] = useState('')
  const [classification, setClassification] = useState('all')
  const [workStatus, setWorkStatus] = useState('active')
  const [publishedFrom, setPublishedFrom] = useState('')
  const [publishedTo, setPublishedTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanFrom, setScanFrom] = useState('')
  const [scanTo, setScanTo] = useState('')
  const [activeScanRange, setActiveScanRange] = useState(null)
  const [selected, setSelected] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const wasScanning = useRef(false)
  const originElement = useRef(null)

  const loadNotices = useCallback(async () => {
    setNoticesState('loading')
    try {
      const response = await fetch('/api/notices')
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

    fetch('/api/status')
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

    fetch('/api/scan/status')
      .then((response) => {
        if (!response.ok) throw new Error('Scan status request failed')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        if (body?.running === true) {
          setScanning(true)
          if (body.from && body.to) setActiveScanRange({ from: body.from, to: body.to })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadNotices()
  }, [loadNotices])

  useEffect(() => {
    if (!scanning) return undefined
    let stopped = false

    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/scan/status')
        if (!response.ok) return
        const body = await response.json()
        if (stopped) return
        if (body?.running !== true) {
          setScanning(false)
          setActiveScanRange(null)
          return
        }
        if (body.from && body.to) {
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
    const validation = validateScanRange(scanFrom, scanTo)
    if (!validation.ok) {
      setScanError(validation.error)
      return
    }

    try {
      const headers = validation.payload
        ? { 'Content-Type': 'application/json' }
        : undefined
      const response = await fetch('/api/scan', {
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
    setNotices((current) => current.map((notice) => {
      if (String(notice.referenceNumber) !== String(updated.referenceNumber)) return notice
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
    originElement.current = element || null
    setSelected({ id, rect: plainRect(element?.getBoundingClientRect()) })
    setPanelOpen(true)
  }

  const requestClose = useCallback(() => setPanelOpen(false), [])

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

  function updateClassification(value) {
    if (value !== classification) setPage(1)
    setClassification(value)
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

  function showOpportunities(filter, { scrollTo = 'list' } = {}) {
    setShowReports(false)
    if (filter) updateClassification(filter)
    if (scrollTo === 'featured') scrollToFeatured()
    else scrollToOpportunities()
  }

  const dateScopedNotices = useMemo(
    () => noticesInPublishedRange(notices, publishedFrom, publishedTo),
    [notices, publishedFrom, publishedTo],
  )
  const counts = noticesState === 'ready' ? countClassifications(dateScopedNotices) : EMPTY_COUNTS
  const visibleNotices = useMemo(
    () => filterNotices(sortNotices(notices), {
      query,
      classification,
      workStatus,
      publishedFrom,
      publishedTo,
    }),
    [notices, query, classification, workStatus, publishedFrom, publishedTo],
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

  function scrollToOpportunities() {
    document.getElementById('opportunities')?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  function scrollToFeatured() {
    document.getElementById('featured')?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  function goToPage(next) {
    const target = Math.min(Math.max(1, next), pageCount)
    if (target === currentPage) return
    setPage(target)
    scrollToOpportunities()
  }

  return (
    <>
      <div className={`${selected ? 'site is-receded' : 'site'}${showReports ? ' is-reports' : ''}`} aria-hidden={selected ? 'true' : undefined}>
        <div className="page-sheet" id="top">
        <Header
          online={online}
          scanning={scanning}
          scanRangeLabel={activeScanRange
            ? formatScanRangeLabel(activeScanRange.from, activeScanRange.to)
            : ''}
          onShowOpportunities={() => showOpportunities()}
          onShowSoftware={() => showOpportunities('software')}
          onShowReports={() => setShowReports(true)}
        />
        <main>
          {showReports ? (
            <ScanReports onClose={() => setShowReports(false)} />
          ) : (
          <>
          <Hero
            total={counts.software}
            state={noticesState}
            scanning={scanning}
            scanError={scanError}
            scanFrom={scanFrom}
            scanTo={scanTo}
            onScanFromChange={setScanFrom}
            onScanToChange={setScanTo}
            onClearScanRange={clearScanRange}
            onScan={startScan}
          />
          <Statistics
            counts={counts}
            active={classification}
            onSelect={(filter) => showOpportunities(filter, { scrollTo: 'featured' })}
          />
          <FeaturedOpportunities
            notices={featured}
            total={featuredTotal}
            state={noticesState}
            category={classification}
            onOpen={openNotice}
            onViewAll={() => showOpportunities(classification)}
          />
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
              workStatus={workStatus}
              onWorkStatus={updateWorkStatus}
              publishedFrom={publishedFrom}
              publishedTo={publishedTo}
              onPublishedFromChange={updatePublishedFrom}
              onPublishedToChange={updatePublishedTo}
              onClearPublishedDates={clearPublishedDates}
            />
            <OpportunityList notices={pageNotices} state={noticesState} onOpen={openNotice} />
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
          {showReports ? null : <div className="footer-reveal-sentinel" aria-hidden="true" />}
        </main>
        </div>
        {showReports ? null : <Footer />}
      </div>

      {selected ? (
        <ExpandingPanel
          key={selected.id}
          originRect={selected.rect}
          open={panelOpen}
          onRequestClose={requestClose}
          onClosed={handleClosed}
          label={`Notice ${selected.id}`}
        >
          <NoticeDetails
            noticeId={selected.id}
            onBack={requestClose}
            onClassified={applyClassification}
          />
        </ExpandingPanel>
      ) : null}
    </>
  )
}
