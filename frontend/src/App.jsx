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
import { padCount } from './format.js'
import { countClassifications, filterNotices, softwareNotices, sortNotices } from './notices.js'
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [selected, setSelected] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
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
        if (!cancelled && body?.running === true) setScanning(true)
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
        if (body?.running !== true) setScanning(false)
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
    loadNotices()
  }, [scanning, loadNotices])

  async function startScan() {
    if (scanning) return
    setScanError('')
    try {
      const response = await fetch('/api/scan', { method: 'POST' })
      if (response.status === 202 || response.status === 409) {
        setScanning(true)
        return
      }
      setScanError('Unable to start the scan.')
    } catch {
      setScanError('Unable to start the scan.')
    }
  }

  function applyClassification(updated) {
    setNotices((current) => current.map((notice) => {
      if (String(notice.referenceNumber) !== String(updated.referenceNumber)) return notice
      return {
        ...notice,
        classification: updated.classification,
        classificationSource: updated.classificationSource,
        reviewed: updated.reviewed,
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

  function updatePageSize(size) {
    if (size === pageSize) return
    setPageSize(size)
    setPage(1)
  }

  function showOpportunities(filter) {
    if (filter) updateClassification(filter)
    scrollToOpportunities()
  }

  const counts = noticesState === 'ready' ? countClassifications(notices) : EMPTY_COUNTS
  const visibleNotices = useMemo(
    () => filterNotices(sortNotices(notices), { query, classification }),
    [notices, query, classification],
  )
  const pageCount = Math.max(1, Math.ceil(visibleNotices.length / pageSize) || 1)
  const currentPage = Math.min(page, pageCount)
  const pageNotices = visibleNotices.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const featured = useMemo(() => softwareNotices(notices, FEATURED_LIMIT), [notices])

  function scrollToOpportunities() {
    document.getElementById('opportunities')?.scrollIntoView({
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
      <div className={selected ? 'site is-receded' : 'site'} aria-hidden={selected ? 'true' : undefined}>
        <div className="page-sheet" id="top">
        <Header
          online={online}
          scanning={scanning}
          onShowOpportunities={() => showOpportunities()}
          onShowSoftware={() => showOpportunities('software')}
        />
        <main>
          <Hero
            total={counts.all}
            state={noticesState}
            scanning={scanning}
            scanError={scanError}
            onScan={startScan}
          />
          <Statistics counts={counts} active={classification} onSelect={showOpportunities} />
          <FeaturedOpportunities
            notices={featured}
            total={counts.software}
            state={noticesState}
            onOpen={openNotice}
            onViewAll={() => showOpportunities('software')}
          />
          <section id="opportunities" className="opportunities" aria-labelledby="opportunities-title">
            <div className="section-rule">
              <h2 id="opportunities-title" className="mono">
                All opportunities / {noticesState === 'ready' ? padCount(visibleNotices.length) : '···'}
              </h2>
            </div>
            <NoticeFilters
              query={query}
              onQueryChange={updateQuery}
              active={classification}
              onSelect={updateClassification}
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
          <div className="footer-reveal-sentinel" aria-hidden="true" />
        </main>
        </div>
        <Footer />
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
