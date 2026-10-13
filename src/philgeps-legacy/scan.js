import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classificationLabel } from '../classification/cache.js'
import { delay } from '../log.js'
import { preAttachmentDecision } from '../process-notice.js'
import { LEGACY_PORTAL, isSafeStorageId } from '../notice-source.js'
import { classificationFields } from '../review/decision.js'
import { attachWorkStatus } from '../review/work-status.js'
import { legacyCalendarDate } from './dates.js'
import {
  NEXT_PAGE_TARGET,
  OPEN_LIST_URL,
  abstractUrl,
  legacyDelayMs,
  legacyRequest,
} from './http.js'
import { isSmallValueProcurement, parseAbstract, parseOpenList } from './parse.js'

const MAX_PAGES = 5
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function emptyStats() {
  return {
    pagesVisited: 0,
    noticesInspected: 0,
    smallValueFound: 0,
    noticesClassified: 0,
    noticesSaved: 0,
    alreadySaved: 0,
    softwareCount: 0,
    notRelevantCount: 0,
    reviewCount: 0,
    duplicatesSkipped: 0,
    errors: [],
    stopped: false,
    stopReason: null,
  }
}

export function assertLegacyPageLimit(pageLimit) {
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGES) {
    throw new Error('Old PhilGEPS page limit must be a whole number from 1 to 5.')
  }
}

function applyLegacyDates(notice) {
  const posted = legacyCalendarDate(notice.postedDate)
  const closing = legacyCalendarDate(notice.deadline)
  return {
    ...notice,
    postedDate: posted,
    publishedDate: posted,
    deadline: closing,
    closingDate: closing,
  }
}

function reviewWithoutDocuments(relevance) {
  const reasons = [...(relevance?.reasons || [])]
  reasons.push('No public Old PhilGEPS document was available, so the notice stays for review.')
  return {
    ...relevance,
    isRelevant: false,
    needsReview: true,
    reasons,
  }
}

function classifyLegacyNotice(notice, rules) {
  const plan = preAttachmentDecision(notice, rules)
  const relevance = plan.decision === 'inspect'
    ? reviewWithoutDocuments(plan.relevance)
    : plan.relevance
  const fields = attachWorkStatus(classificationFields(relevance, { status: 'pending' }), null)
  return { relevance, ...fields }
}

async function saveLegacyPacket(outputDir, storageId, packet) {
  if (!isSafeStorageId(storageId) || !storageId.startsWith('legacy-')) {
    throw new Error('Refusing to write a notice outside legacy-<id>.json.')
  }
  const outputPath = path.resolve(outputDir, `${storageId}.json`)
  const directory = path.resolve(outputDir)
  if (!outputPath.startsWith(`${directory}${path.sep}`)) {
    throw new Error('Refusing to write a notice outside the output directory.')
  }
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx' })
    return 'saved'
  } catch (error) {
    if (error.code === 'EEXIST') return 'exists'
    throw error
  }
}

function snapshotStats(stats) {
  return {
    pagesVisited: stats.pagesVisited,
    noticesInspected: stats.noticesInspected,
    smallValueFound: stats.smallValueFound,
    noticesClassified: stats.noticesClassified,
    noticesSaved: stats.noticesSaved,
    alreadySaved: stats.alreadySaved,
    softwareCount: stats.softwareCount,
    notRelevantCount: stats.notRelevantCount,
    reviewCount: stats.reviewCount,
    duplicatesSkipped: stats.duplicatesSkipped,
    errors: stats.errors.map((item) => ({ ...item })),
    stopped: stats.stopped,
    stopReason: stats.stopReason,
  }
}

function emitProgress(onProgress, stats) {
  if (typeof onProgress === 'function') onProgress(snapshotStats(stats))
}

function stop(stats, reason, error, referenceNumber = null, onProgress) {
  stats.stopped = true
  stats.stopReason = reason
  stats.errors.push({
    referenceNumber,
    message: error?.message || String(error),
  })
  emitProgress(onProgress, stats)
  return stats
}

/**
 * Read a bounded number of public Old PhilGEPS open-list pages and their abstracts.
 * Does not download documents. Does not replace an existing legacy file or any
 * current-portal numeric file. A failed page stops the walk. Notices saved
 * before that failure stay on disk.
 */
export async function runLegacyScan({
  pageLimit,
  outputDir,
  request,
  fetchImpl,
  wait = () => delay(legacyDelayMs()),
  signal,
  rules,
  onProgress,
} = {}) {
  assertLegacyPageLimit(pageLimit)
  if (!outputDir) throw new Error('outputDir is required.')
  const performRequest = request || ((spec) => legacyRequest(spec?.url, {
    method: spec?.method,
    form: spec?.form,
    referer: spec?.referer,
    fetchImpl,
  }))

  const relevanceRules = rules || JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'))
  const stats = emptyStats()
  const seen = new Set()
  let pageUrl = OPEN_LIST_URL
  let pageForm = null
  let method = 'GET'

  for (let page = 1; page <= pageLimit; page += 1) {
    if (signal?.aborted) return stop(stats, 'interrupted', new Error('Old PhilGEPS scan was interrupted.'), null, onProgress)

    let html
    try {
      await wait()
      if (signal?.aborted) return stop(stats, 'interrupted', new Error('Old PhilGEPS scan was interrupted.'), null, onProgress)
      const form = method === 'POST'
        ? {
          __EVENTTARGET: NEXT_PAGE_TARGET,
          __EVENTARGUMENT: '',
          __VIEWSTATE: pageForm.viewState,
          __VIEWSTATEGENERATOR: pageForm.viewStateGenerator || '',
          __EVENTVALIDATION: pageForm.eventValidation || '',
        }
        : undefined
      const response = await readWithRetry(performRequest, { url: pageUrl, method, form, referer: OPEN_LIST_URL }, wait, signal)
      html = response.text
    } catch (error) {
      if (error?.code === 'LEGACY_INTERRUPTED') return stop(stats, 'interrupted', error, null, onProgress)
      return stop(stats, 'request-failed', error, null, onProgress)
    }

    const list = parseOpenList(html)
    if (list.failed) {
      return stop(stats, 'site-error', new Error('Transaction cannot be completed at this time.'), null, onProgress)
    }
    stats.pagesVisited += 1
    stats.duplicatesSkipped += list.duplicateIds.length
    emitProgress(onProgress, stats)

    for (const referenceId of list.referenceIds) {
      if (seen.has(referenceId)) {
        stats.duplicatesSkipped += 1
        continue
      }
      seen.add(referenceId)
      if (signal?.aborted) return stop(stats, 'interrupted', new Error('Old PhilGEPS scan was interrupted.'), referenceId, onProgress)

      let parsed
      try {
        await wait()
        if (signal?.aborted) return stop(stats, 'interrupted', new Error('Old PhilGEPS scan was interrupted.'), referenceId, onProgress)
        const response = await readWithRetry(performRequest, {
          url: abstractUrl(referenceId),
          method: 'GET',
          referer: pageUrl,
        }, wait, signal)
        parsed = parseAbstract(response.text, abstractUrl(referenceId))
      } catch (error) {
        if (error?.code === 'LEGACY_INTERRUPTED') return stop(stats, 'interrupted', error, referenceId, onProgress)
        return stop(stats, 'request-failed', error, referenceId, onProgress)
      }

      if (parsed.failed) {
        return stop(stats, 'site-error', new Error('Transaction cannot be completed at this time.'), referenceId, onProgress)
      }
      if (!parsed.notice.referenceNumber || parsed.notice.referenceNumber !== referenceId) {
        stats.errors.push({
          referenceNumber: referenceId,
          message: 'The abstract did not include the open-list reference number.',
        })
        continue
      }

      const notice = applyLegacyDates({
        ...parsed.notice,
        referenceNumber: parsed.notice.referenceNumber,
      })
      stats.noticesInspected += 1
      if (!isSmallValueProcurement(notice.procurementMode)) continue

      stats.smallValueFound += 1
      const classified = classifyLegacyNotice(notice, relevanceRules)
      stats.noticesClassified += 1
      if (classified.classification === 'software') stats.softwareCount += 1
      else if (classified.classification === 'not relevant') stats.notRelevantCount += 1
      else stats.reviewCount += 1
      const storageId = `legacy-${notice.referenceNumber}`
      const packet = {
        notice,
        documents: [],
        documentAccess: parsed.documentListLinked ? 'login-required' : null,
        source: { id: LEGACY_PORTAL.id, label: LEGACY_PORTAL.label },
        requirements: { items: [] },
        relevance: classified.relevance,
        classification: classified.classification || classificationLabel(classified.relevance) || 'review',
        classificationSource: classified.classificationSource,
        reviewed: false,
        reviewedAt: null,
      }
      if (classified.workStatus) packet.workStatus = classified.workStatus

      try {
        const outcome = await saveLegacyPacket(outputDir, storageId, packet)
        if (outcome === 'saved') stats.noticesSaved += 1
        else stats.alreadySaved += 1
        emitProgress(onProgress, stats)
      } catch (error) {
        return stop(stats, 'request-failed', error, notice.referenceNumber, onProgress)
      }
    }

    if (page === pageLimit || !list.hasNext) break
    if (!list.form.viewState) {
      return stop(stats, 'missing-viewstate', new Error('The next open-list page had no viewstate, so the walk stopped.'), null, onProgress)
    }
    pageForm = list.form
    method = 'POST'
    pageUrl = OPEN_LIST_URL
  }

  emitProgress(onProgress, stats)
  return stats
}

async function readWithRetry(request, spec, wait, signal) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (signal?.aborted) {
        const error = new Error('Old PhilGEPS scan was interrupted.')
        error.code = 'LEGACY_INTERRUPTED'
        throw error
      }
      const result = await request(spec)
      const status = Number(result?.status || 0)
      if (status >= 400) {
        const error = new Error(`HTTP ${status} for ${spec.url}`)
        error.status = status
        throw error
      }
      if (!result || typeof result.text !== 'string') {
        throw new Error('The Old PhilGEPS response had no page text.')
      }
      return result
    } catch (error) {
      lastError = error
      const retryable = error?.code !== 'LEGACY_INTERRUPTED'
        && error?.code !== 'LEGACY_BLOCKED_URL'
        && !(Number.isInteger(error?.status) && error.status < 500)
      if (attempt === 1 && retryable) {
        await wait()
        continue
      }
      throw error
    }
  }
  throw lastError
}
