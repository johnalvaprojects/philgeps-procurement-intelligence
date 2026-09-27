import { padCount } from '../format.js'

const PAGE_SIZES = [25, 50, 100]

function pageTokens(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis', total]
  if (current >= total - 3) return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total]
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis-end', total]
}

function padPage(value) {
  return String(value).padStart(2, '0')
}

export default function OpportunityPager({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}) {
  if (total === 0) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const tokens = pageCount > 1 ? pageTokens(page, pageCount) : []

  return (
    <div className="pager">
      {pageCount > 1 ? (
        <nav className="pager-nav" aria-label="Opportunity pages">
          <button
            type="button"
            className="pager-step mono"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            ← Previous
          </button>
          <ol className="pager-pages">
            {tokens.map((token) => (
              String(token).startsWith('ellipsis') ? (
                <li key={token} className="pager-gap mono" aria-hidden="true">...</li>
              ) : (
                <li key={token}>
                  <button
                    type="button"
                    className={token === page ? 'pager-page mono is-current' : 'pager-page mono'}
                    onClick={() => onPageChange(token)}
                    aria-current={token === page ? 'page' : undefined}
                    aria-label={`Page ${token}`}
                  >
                    {padPage(token)}
                  </button>
                </li>
              )
            ))}
          </ol>
          <button
            type="button"
            className="pager-step mono"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
          >
            Next →
          </button>
        </nav>
      ) : null}
      <div className="pager-meta">
        <p className="mono pager-showing">
          Showing {padCount(from)}–{padCount(to)} / {padCount(total)}
        </p>
        <div className="pager-sizes" role="group" aria-label="Results per page">
          {PAGE_SIZES.map((size, index) => (
            <span key={size} className="filter-item">
              {index > 0 ? <span className="filter-slash" aria-hidden="true">/</span> : null}
              <button
                type="button"
                className={pageSize === size ? 'filter mono is-active' : 'filter mono'}
                onClick={() => onPageSizeChange(size)}
                aria-pressed={pageSize === size}
              >
                {size}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
