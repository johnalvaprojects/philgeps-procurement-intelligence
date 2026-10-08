# PhilGEPS Procurement Automation — V2 Implementation Plan

**Status:** Audit and plan only. No V2 features are implemented.  
**Checkpoint checks (this run):** `npm test` — 233 passed, 0 failed. `frontend` `npm run build` — succeeded.  
**Out of scope:** Product matching, vendor discovery, pricing, quotations, bidding, and submissions.

---

## 1. Current architecture

Local Node.js (≥ 22.13) application. Express serves saved notices. React/Vite is the review UI and proxies `/api` to the API.

```text
Modern PhilGEPS (philgeps.gov.ph)
  src/philgeps/client.js          HTTP get, delay, timeout
  src/philgeps/search.js          SVP listing + date window
  src/philgeps/notices.js         Detail HTML → notice object
  src/philgeps/documents.js       Public attachment download
        ↓
  src/process-notice.js           classify → download → extract → save
  src/classification/relevance.js
  src/extraction/extract.js + ocr.js + pdf/docx/xlsx
  src/extraction/software-requirements.js
        ↓
  data/output/<numericId>.json
  data/output/<numericId>.extracted.txt
  data/output/<numericId>.requirements.json
  data/documents/<numericId>/
        ↓
  src/server  GET/PATCH /api/notices, POST /api/scan
  frontend    lists, case detail, classification, work status
```

**Persistence today**

- Packet key is the modern numeric reference (`data/output/92301.json`).
- `GET /api/notices` only loads files matching `/^\d+\.json$/` (`notice-controller.js`). Prefixed filenames would be invisible until that filter is widened.
- Scan progress (`src/scan-progress.js`) is in-memory only. Scan logs are text files under `data/logs/`. There is no stored daily-report object.
- Notice dates are stored as PhilGEPS display strings (`DD-Mon-YYYY`), not rewritten to ISO.

**Date presentation today** (`frontend/src/format.js`)

| Function | Current display | Used by |
|----------|-----------------|---------|
| `formatDateLabel` | `MON DD YYYY` (example: `OCT 08 2026`) | Case detail |
| `formatDateDots` | `DD.MM.YYYY` (day first) | Cards and lists |
| `publishTime` / `filterDayTime` | UTC day keys for filtering | Filters only |

HTML date inputs stay `YYYY-MM-DD`. Backend `parsePhilgepsDate` in `search.js` is a calendar parser for the scan window, not a display formatter.

**Reusable for V2 (do not fork)**

- Classifier, OCR, PDF/DOCX/XLSX extraction, and `software-requirements.js`.
- `process-notice.js` orchestration, once a source adapter supplies the same notice shape and a non-colliding id.
- Review UI, classification, and work status, once the API returns `source` and dates go through one formatter.

**Integration points**

| Concern | Where to extend |
|---------|-----------------|
| Listing + detail fetch | New adapter beside `src/philgeps/`, not inside modern parsers |
| Orchestration | `process-notice.js` only if it accepts an injected source; keep the modern path the default |
| Storage id | `saveResult` filename, `data/documents/<id>/`, API id filter |
| Display dates | `frontend/src/format.js` only |
| Reports | New print views in `frontend/`; data from existing packets plus a new scan-summary file if a daily report must survive restart |
| Source label | Optional field on new packets; missing field means current PhilGEPS |

---

## 2. Legacy PhilGEPS — verified vs unknown

Probed on 8 October 2026 with a normal browser User-Agent. No login, CAPTCHA bypass, or session forging.

### Verified

| Observation | Evidence |
|-------------|----------|
| Public legacy host | `https://notices.philgeps.gov.ph` |
| Open-opportunity index | `GET /GEPSNONPILOT/Tender/SplashOpenOpportunitiesUI.aspx?ClickFrom=OpenOpp&menuIndex=3` returns category counts |
| Public search results | `GET .../SplashOpportunitiesSearchUI.aspx?ClickFrom=OpenOpp&Result=3&menuIndex=3` returned **HTTP 200** (~104 KB) |
| Row links | Relative `SplashBidNoticeAbstractUI.aspx?menuIndex=3&refID=<digits>&Result=3` |
| Public abstract | `refID=12298874` returned **HTTP 200**. Visible labels: Reference Number, Solicitation Number, Procurement Mode, Category, Approved Budget for the Contract, Client Agency, Date Published, Closing Date / Time, Document Request List |
| Listing dates | Sample publish cell `08/10/2026` on the same calendar day as this audit (8 Oct 2026). Treat listing dates as **day/month/year**, not month/day/year, until a second dated sample contradicts that |
| Attachments are not public | “Document Request List” points at `ViewDocumentRequestList.aspx`, which **redirected to** `https://notices.philgeps.gov.ph/GEPSNONPILOT/log-in.aspx` (**HTTP 200** login page). No PDF/DOCX links on the abstract |
| ASP.NET page | Search HTML contains `__VIEWSTATE` |

### Unknown (do not assume)

- Whether detailed search (keyword, category, publish range) can be driven by a stable GET, or only by ASP.NET postback.
- Full pagination contract beyond the `Result=` query value seen on the open list.
- Whether any legacy notices expose public file URLs. The sampled abstract did not.
- Overlap rate between legacy `refID` and modern numeric reference numbers. Collision is possible because both are integers.
- Long-term availability. The legacy site is a separate system from `https://philgeps.gov.ph`.

### Constraint

Do not log in, solve CAPTCHA, or reuse merchant cookies to reach the document list. A legacy adapter may ingest **public abstract fields** only until attachments are reachable without authentication. Classification can still run on title plus structured public fields. Document download, OCR, and file-based requirement extraction stay unused when no public file exists. That is a data limit, not a reason to change the classifier or OCR.

---

## 3. Source adapter and ID safety

### Contract

A source adapter returns the same notice fields `process-notice` already expects (`title`, `organization`, `postedDate`, `deadline`, `abc`, `procurementMode`, line items, `url`) plus:

```text
source.id          "modern" | "legacy"
source.label       "PhilGEPS" | "Legacy PhilGEPS"
source.noticeUrl   original public URL
storageId          filename key (see below)
```

Modern scanning stays on `src/philgeps/*` and `PHILGEPS_BASE_URL`. Legacy gets `src/philgeps-legacy/` (or `src/sources/legacy/`) and its own base URL. Shared code starts at classification of plain text and at extraction of already-downloaded files.

### IDs

| Record | Storage key | Rule |
|--------|-------------|------|
| Existing V1 packets | Unchanged `92301.json` | Never rename or rewrite |
| New modern notices | Continue `<digits>.json` | Current scan behavior stays |
| Legacy notices | `legacy-<refID>.json` and `data/documents/legacy-<refID>/` | Never use the bare refID as the filename |

API list filter must allow `legacy-<digits>.json` in addition to `/^\d+\.json$/`. Document download routes must keep path traversal checks.

Dedup key is `source.id + native id`, not the bare number. A modern `12298874` and a legacy `12298874` are different notices.

Packets without `source` are displayed as current PhilGEPS. Do not backfill old files in the first implementation.

### Legacy processing when files are gated

Save the public abstract, run title/structured classification, and mark documents as unavailable because the document list requires login. Do not invent attachment text or requirements from the abstract beyond fields actually present. Requirement JSON is produced only when classification is software **and** usable document text exists, matching V1.

---

## 4. Date formatting

**Change display only.**

- Add one presentation helper in `frontend/src/format.js`, for example month-first `MM/DD/YYYY`, with an optional long form `Month DD, YYYY` for report headings.
- Parse the existing PhilGEPS token `DD-Mon-YYYY` and ISO `YYYY-MM-DD` as calendar dates. Do not pass them through `Date` local timezone conversion.
- Invalid or unrecognized strings stay visible as stored text (current `displayText` behavior). Do not coerce them to a guessed date.
- Replace `formatDateDots` call sites (lists and cards). It is day-first today (`DD.MM.YYYY`).
- Keep `publishTime`, `filterDayTime`, `parsePhilgepsDate`, stored `postedDate` / `deadline`, and requirement provenance strings unchanged.
- Legacy `DD/MM/YYYY` and `DD/MM/YYYY hh:mm AM/PM` values must be normalized to the existing stored calendar style **inside the legacy adapter only**, before they reach shared UI formatters. The UI formatter should not guess which slash format it was given.

---

## 5. PDF reports

### Recommended approach

**Browser print views in the React app**, with a dedicated black-and-white print stylesheet (`@media print`, page margins, `page-break` between sections). Download is the browser **Save as PDF / Print to PDF**.

Why this is the safest fit:

- No Puppeteer/Chromium install on the work laptop.
- No second layout engine that can drift from the case page.
- Pagination is CSS, which matches the “print and download” requirement.
- Data is whatever the API already returns. Empty fields stay blank.

Server-generated PDF (PDFKit or headless Chrome) is a later option only if unattended file output is required. It is not required to meet a human “print/download” workflow.

### Layout

Editorial, monochrome, Trustera-like hierarchy: organization name, document title, meta line (source, notice id, generated date), then labeled sections. Not a quotation, price sheet, or bid form. No prices other than ABC values already stored. No “recommended vendor” or match language.

### Daily scan report

There is no persisted scan summary today. Phase 2 should write a small JSON sidecar when a scan finishes (from `scan-progress.js` counters plus the run window), without rewriting notice packets. Suggested file: `data/output/scan-reports/<startedAt>.json` (new files only).

| Section | Source fields |
|---------|----------------|
| Report date | Scan `startedAt`, formatted for display |
| Window | `from`, `to` |
| Counts | discovered, processed, software, review, not relevant, already processed, errors, documents downloaded |
| Completion | `complete`, `completionReason` |
| Software and review rows | Matching saved packets for that run only if the summary stores their storage ids. Do not infer a run from all historical files |
| Errors | Count plus logged notice ids if the scan already records them. Do not invent error text |

If a historical day has no summary file, the UI says no daily report is stored. It must not synthesize one from the whole archive.

### Case report

One saved packet plus `extractedRequirements` when present.

| Section | Include |
|---------|---------|
| Identity | Title, organization, storage id, native reference, **source label and source URL** |
| Notice dates | Published, closing — display formatter only |
| Money | ABC and financial scope already extracted. Omit the section content when null |
| Items | Description, quantity, unit, licenses, term, license type |
| Technical / delivery / submission | Stored values only |
| Provenance | `source` and `confidence` on fields that have them |
| Conflicts and review | `conflicts`, `fieldsNeedingReview`, extraction status, classification, work status |
| Documents | Saved filenames. If none, say none are stored |

---

## 6. Files expected to change (when implementation is approved)

**Phase 1 — dates**

- `frontend/src/format.js`
- Call sites in `OpportunityCard.jsx`, `OpportunityList.jsx`, `NoticeDetails.jsx`, and requirement date labels in `ProcurementRequirements.jsx` if they render raw dates
- Frontend tests if date helpers are covered; add a small formatter test rather than changing classifier tests

**Phase 2 — reports**

- New print components and print CSS under `frontend/src/`
- Optional `src/scan-progress.js` consumer that writes a scan-summary JSON at end of scan (new files only)
- A read API for that summary if the daily page cannot read `data/` directly (it cannot)

**Phase 3 — legacy source**

- New `src/philgeps-legacy/` adapter
- `notice-controller.js` id filter and document path allow-list
- Thin branch in scan/process entry so modern `search.js` / `notices.js` / `documents.js` stay the default
- Frontend source label
- No edits to `relevance.js` or `ocr.js` for legacy behavior

Not in this plan: `software-requirements.js` rule changes, product matching, pricing.

---

## 7. Phases and acceptance

### Phase 1 — Display dates

1. Central month-first formatter.
2. Lists, cards, and case detail use it.
3. Stored JSON and scan-window parsing unchanged.

**Accept:** A `06-Oct-2026` value renders `10/06/2026` (or `October 06, 2026` where the long form is chosen). `DD.MM.YYYY` is gone from the UI. An unparseable string is shown unchanged. `npm test` and frontend build still pass.

### Phase 2 — Printable reports

1. Case print view from an existing packet.
2. Daily print view only when a scan summary exists.
3. Print CSS: monochrome, page breaks, no invented fields.

**Accept:** Print preview for a known software case shows only stored ABC, items, conflicts, and source. A notice with null specs does not gain specs. Daily page without a summary file does not list the whole archive.

### Phase 3 — Legacy adapter (public fields only)

1. Parse public search rows and one abstract into the notice contract, behind an explicit CLI/API flag.
2. Store as `legacy-<refID>` without touching existing numeric files.
3. Show “Legacy PhilGEPS” and the abstract URL.
4. Leave document download idle when the document list redirects to login.

**Accept:** A modern scan still writes `<digits>.json` only. A legacy trial writes `legacy-<refID>.json` and does not overwrite a same-number modern file. Classifier and OCR tests stay green without logic edits in those modules.

Phase 3 starts only after a short pagination spike records how the next search page is requested. If that requires authenticated postback, stop and report it. Do not ship a partial scraper that silently drops pages.

---

## 8. Risks and rollback

| Risk | Mitigation |
|------|------------|
| Legacy refID overwrites a modern packet | Prefixed storage id; no migration of old files |
| Slash dates parsed backwards | Adapter normalizes legacy dates; UI does not guess slash order |
| Login wall treated as an empty document set and then classified as software from the title alone | Same as V1 title rules; do not OCR a login page. Record document access as unavailable |
| Daily report mixes old notices | Report binds to ids saved on that scan summary |
| Print layout drifts into a quotation | No price/vendor sections in the template |
| ASP.NET markup change | Legacy adapter isolated; modern scan path untouched |

**Rollback:** Revert the phase branch. Existing `data/output/<digits>.json` files are not rewritten, so V1 UI and scans keep working. New `legacy-*` files and `scan-reports/` can be left unused or removed without affecting V1 packets.

---

## 9. This run

- Runtime source was not changed.
- Checks: **233 tests passed, 0 failed**; frontend production **build succeeded**.
- Legacy findings above are from live public GETs on 8 October 2026. Pagination and any public attachment exceptions remain unknown.
