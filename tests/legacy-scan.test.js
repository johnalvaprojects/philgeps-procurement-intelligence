import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { documentsRequireLogin } from '../src/notice-source.js'
import { legacyCalendarDate } from '../src/philgeps-legacy/dates.js'
import { OPEN_LIST_URL, abstractUrl, assertPublicLegacyUrl, legacyRequest } from '../src/philgeps-legacy/http.js'
import { isSmallValueProcurement, parseAbstract, parseOpenList } from '../src/philgeps-legacy/parse.js'
import { assertLegacyPageLimit, runLegacyScan } from '../src/philgeps-legacy/scan.js'

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'legacy')

async function fixture(name) {
  return readFile(path.join(fixtureDir, name), 'utf8')
}

function pages(files) {
  return async function request(spec) {
    const url = String(spec.url)
    assert.equal(assertPublicLegacyUrl(url), url)
    assert.doesNotMatch(url, /ViewDocumentRequestList|log-in\.aspx/i)
    if (spec.method === 'POST') {
      assert.equal(spec.form.__EVENTTARGET, 'pgCtrlDetailedSearch$nextLB')
      assert.equal(spec.form.__VIEWSTATE, 'vs-page-1')
      return { status: 200, text: await fixture(files.page2) }
    }
    const ref = url.match(/refID=(\d+)/)?.[1]
    if (ref) return { status: 200, text: await fixture(files[ref]) }
    return { status: 200, text: await fixture(files.open) }
  }
}

const savedFiles = {
  open: 'open-page-1.html',
  page2: 'open-page-2.html',
  20000001: 'abstract-software.html',
  20000002: 'abstract-construction.html',
  20000003: 'abstract-review.html',
  20000004: 'abstract-public-bidding.html',
  20000005: 'abstract-no-items.html',
}

test('legacy dates stay day-month-year and invalid dates stay empty', () => {
  assert.equal(legacyCalendarDate('13/10/2026'), '13-Oct-2026')
  assert.equal(legacyCalendarDate('23/10/2026 10:00 AM'), '23-Oct-2026 10:00 AM')
  assert.equal(legacyCalendarDate('15/10/2026 2:00 PM'), '15-Oct-2026 02:00 PM')
  assert.equal(legacyCalendarDate('32/10/2026'), null)
  assert.equal(legacyCalendarDate(''), null)
  assert.equal(isSmallValueProcurement('Negotiated Procurement - Small Value Procurement'), true)
  assert.equal(isSmallValueProcurement('Public Bidding'), false)
})

test('open-list fixture exposes reference numbers, duplicates, and the next-page post', async () => {
  const list = parseOpenList(await fixture('open-page-1.html'))
  assert.deepEqual(list.referenceIds, ['20000001', '20000002', '20000003', '20000004'])
  assert.deepEqual(list.duplicateIds, ['20000001'])
  assert.equal(list.hasNext, true)
  assert.equal(list.form.viewState, 'vs-page-1')
  assert.equal(list.failed, false)
  const failure = parseOpenList(await fixture('transaction-error.html'))
  assert.equal(failure.failed, true)
})

test('abstract fixture keeps public fields and reads line items only when the grid exists', async () => {
  const software = parseAbstract(await fixture('abstract-software.html'), abstractUrl('20000001'))
  assert.equal(software.notice.referenceNumber, '20000001')
  assert.equal(software.notice.organization, 'SAMPLE AGENCY')
  assert.equal(software.notice.procurementMode, 'Negotiated Procurement - Small Value Procurement')
  assert.equal(software.notice.abc, 'PHP 80,000.00')
  assert.equal(software.documentListLinked, true)
  assert.equal(software.notice.lineItems.length, 1)
  assert.equal(software.notice.lineItems[0].quantity, '4')
  const empty = parseAbstract(await fixture('abstract-no-items.html'), abstractUrl('20000005'))
  assert.deepEqual(empty.notice.lineItems, [])
  assert.equal(empty.documentListLinked, false)
})

test('page limit is required and cannot exceed 5', () => {
  assert.throws(() => assertLegacyPageLimit(undefined), /1 to 5/)
  assert.throws(() => assertLegacyPageLimit(0), /1 to 5/)
  assert.throws(() => assertLegacyPageLimit(6), /1 to 5/)
  assert.doesNotThrow(() => assertLegacyPageLimit(5))
})

test('a bounded fixture scan saves only Small Value legacy files and does not request documents', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-scan-'))
  const currentPath = path.join(outputDir, '20000001.json')
  await writeFile(currentPath, '{"notice":{"referenceNumber":"20000001"}}\n')
  const requested = []
  const stats = await runLegacyScan({
    pageLimit: 2,
    outputDir,
    wait: async () => {},
    request: async (spec) => {
      requested.push(spec.url)
      return pages(savedFiles)(spec)
    },
  })

  assert.equal(stats.pagesVisited, 2)
  assert.equal(stats.noticesInspected, 5)
  assert.equal(stats.smallValueFound, 4)
  assert.equal(stats.noticesClassified, 4)
  assert.equal(stats.noticesSaved, 4)
  assert.equal(stats.softwareCount, 2)
  assert.equal(stats.notRelevantCount, 1)
  assert.equal(stats.reviewCount, 1)
  assert.equal(stats.duplicatesSkipped, 2)
  assert.equal(stats.errors.length, 0)
  assert.equal(stats.stopped, false)
  assert.equal(requested.filter((url) => url.includes('refID=20000001')).length, 1)
  assert.equal(requested.some((url) => /ViewDocumentRequestList|log-in\.aspx/i.test(url)), false)

  const software = JSON.parse(await readFile(path.join(outputDir, 'legacy-20000001.json'), 'utf8'))
  assert.equal(software.source.label, 'Old PhilGEPS')
  assert.equal(software.source.id, 'legacy')
  assert.equal(software.classification, 'software')
  assert.equal(software.notice.postedDate, '13-Oct-2026')
  assert.equal(software.notice.closingDate, '23-Oct-2026 10:00 AM')
  assert.equal(software.notice.lineItems[0].lotName, 'Video editing software license')
  assert.equal(software.documents.length, 0)
  assert.equal(software.requirements.items.length, 0)
  assert.equal(documentsRequireLogin(software), true)
  assert.equal(await readFile(currentPath, 'utf8'), '{"notice":{"referenceNumber":"20000001"}}\n')

  const construction = JSON.parse(await readFile(path.join(outputDir, 'legacy-20000002.json'), 'utf8'))
  assert.equal(construction.classification, 'not relevant')
  assert.equal(construction.notice.deadline, '15-Oct-2026 02:00 PM')

  const review = JSON.parse(await readFile(path.join(outputDir, 'legacy-20000003.json'), 'utf8'))
  assert.equal(review.classification, 'review')
  assert.equal(review.notice.abc, null)
  assert.equal(review.notice.postedDate, null)
  assert.equal(review.documentAccess, null)
  assert.equal(documentsRequireLogin(review), false)

  const quiet = JSON.parse(await readFile(path.join(outputDir, 'legacy-20000005.json'), 'utf8'))
  assert.deepEqual(quiet.notice.lineItems, [])
  assert.equal(quiet.documentAccess, null)
  await assert.rejects(readFile(path.join(outputDir, '20000004.json'), 'utf8'))
  await assert.rejects(readFile(path.join(outputDir, 'legacy-20000001.requirements.json'), 'utf8'))
})

test('an existing legacy file is not overwritten', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-existing-'))
  const saved = path.join(outputDir, 'legacy-20000001.json')
  await writeFile(saved, '{"kept":true}\n')
  const stats = await runLegacyScan({
    pageLimit: 1,
    outputDir,
    wait: async () => {},
    request: pages({ ...savedFiles, 20000002: 'abstract-public-bidding.html', 20000003: 'abstract-public-bidding.html' }),
  })
  assert.equal(await readFile(saved, 'utf8'), '{"kept":true}\n')
  assert.equal(stats.alreadySaved, 1)
  assert.equal(stats.noticesSaved, 0)
})

test('a failed next page keeps earlier saves and stops the walk', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-fail-'))
  let posts = 0
  const stats = await runLegacyScan({
    pageLimit: 2,
    outputDir,
    wait: async () => {},
    request: async (spec) => {
      if (spec.method === 'POST') {
        posts += 1
        if (posts === 1) {
          const error = new Error('HTTP 503 for next page')
          error.status = 503
          throw error
        }
        return { status: 200, text: await fixture('transaction-error.html') }
      }
      return pages(savedFiles)(spec)
    },
  })
  assert.equal(posts, 2)
  assert.equal(stats.pagesVisited, 1)
  assert.equal(stats.stopped, true)
  assert.equal(stats.stopReason, 'site-error')
  assert.equal(stats.noticesSaved, 3)
  assert.equal(stats.errors.length, 1)
  const software = JSON.parse(await readFile(path.join(outputDir, 'legacy-20000001.json'), 'utf8'))
  assert.equal(software.classification, 'software')
})

test('an interrupted scan leaves saved notices in place', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-stop-'))
  const controller = new AbortController()
  let abstracts = 0
  const stats = await runLegacyScan({
    pageLimit: 1,
    outputDir,
    signal: controller.signal,
    wait: async () => {},
    request: async (spec) => {
      if (String(spec.url).includes('refID=')) {
        abstracts += 1
        if (abstracts === 1) controller.abort()
      }
      return pages(savedFiles)(spec)
    },
  })
  assert.equal(stats.stopped, true)
  assert.equal(stats.stopReason, 'interrupted')
  assert.equal(stats.noticesSaved, 1)
  assert.equal(await readFile(path.join(outputDir, 'legacy-20000002.json'), 'utf8').then(() => true, () => false), false)
})

test('document and login URLs are refused before a request is sent', async () => {
  let called = 0
  await assert.rejects(
    () => legacyRequest('https://notices.philgeps.gov.ph/GEPSNONPILOT/Tender/ViewDocumentRequestList.aspx?refID=1', {
      fetchImpl: async () => {
        called += 1
        return { ok: true, status: 200, text: async () => '' }
      },
    }),
    /public pages/,
  )
  assert.equal(called, 0)
  await assert.rejects(
    () => legacyRequest('https://philgeps.gov.ph/Indexes/login/', {
      fetchImpl: async () => {
        called += 1
        return { ok: true, status: 200, text: async () => '' }
      },
    }),
    /public pages/,
  )
  assert.equal(called, 0)
})

test('the default reader requests the public open-list URL', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-default-request-'))
  const urls = []
  const stats = await runLegacyScan({
    pageLimit: 1,
    outputDir,
    wait: async () => {},
    fetchImpl: async (url) => {
      urls.push(String(url))
      return {
        ok: true,
        status: 200,
        text: async () => fixture('transaction-error.html'),
      }
    },
  })
  assert.deepEqual(urls, [OPEN_LIST_URL])
  assert.equal(stats.pagesVisited, 0)
  assert.equal(stats.stopReason, 'site-error')
  assert.equal(stats.errors[0].message, 'Transaction cannot be completed at this time.')
})

test('a server error is tried once more', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'legacy-retry-'))
  let opens = 0
  const stats = await runLegacyScan({
    pageLimit: 1,
    outputDir,
    wait: async () => {},
    request: async (spec) => {
      if (!String(spec.url).includes('refID=')) {
        opens += 1
        if (opens === 1) {
          const error = new Error('timed out')
          throw error
        }
      }
      return pages({
        ...savedFiles,
        open: 'open-page-1.html',
        20000002: 'abstract-public-bidding.html',
        20000003: 'abstract-public-bidding.html',
        20000004: 'abstract-public-bidding.html',
      })(spec)
    },
  })
  assert.equal(opens, 2)
  assert.equal(stats.pagesVisited, 1)
  assert.equal(stats.stopped, false)
  assert.equal(stats.noticesSaved, 1)
})
