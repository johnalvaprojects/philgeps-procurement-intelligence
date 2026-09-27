import { publishTime } from './format.js'

export function countClassifications(notices) {
  const counts = {
    all: notices.length,
    software: 0,
    review: 0,
    notRelevant: 0,
  }

  for (const notice of notices) {
    if (notice.classification === 'software') counts.software += 1
    else if (notice.classification === 'review') counts.review += 1
    else if (notice.classification === 'not relevant') counts.notRelevant += 1
  }

  return counts
}

export function sortNotices(notices) {
  return [...notices].sort((left, right) => {
    const leftTime = publishTime(left.postedDate)
    const rightTime = publishTime(right.postedDate)
    if (leftTime == null && rightTime == null) return 0
    if (leftTime == null) return 1
    if (rightTime == null) return -1
    return rightTime - leftTime
  })
}

export function softwareNotices(notices, limit = 5) {
  return sortNotices(notices.filter((notice) => notice.classification === 'software')).slice(0, limit)
}

export function filterNotices(notices, { query, classification }) {
  const needle = query.trim().toLowerCase()

  return notices.filter((notice) => {
    if (classification !== 'all' && notice.classification !== classification) return false
    if (!needle) return true
    const haystack = [notice.referenceNumber, notice.title, notice.organization]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}
