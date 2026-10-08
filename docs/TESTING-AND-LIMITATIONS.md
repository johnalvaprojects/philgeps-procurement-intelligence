# Testing and limitations

## How to run the tests

From the project root:

```bash
npm test
```

That runs `node --test`, which loads every `tests/*.js` file. The frontend package has no test script. `npm test` inside `frontend/` fails because that script is not defined.

The frontend production check is separate:

```bash
cd frontend
npm run build
```

Tests use fixtures and stubs. They do not download live PhilGEPS notices and they do not need `.env`.

## What the suite covers

| File | What it checks |
|------|----------------|
| `tests/status.test.js` | `GET /api/status` |
| `tests/notices.test.js` | Notice list and one notice |
| `tests/documents.test.js` | Document list and file serving, including a path that leaves the notice folder |
| `tests/classification-api.test.js` | Manual classification API |
| `tests/work-status.test.js` | Work status values and persistence |
| `tests/scan-api.test.js` | Scan start, status, and conflict while a scan is running |
| `tests/scan-range.test.js` | Default window and date validation |
| `tests/scan-pagination.test.js` | Page walk, duplicate page stop, date boundary |
| `tests/scan-reports.test.js` | Report counts, matching software including previously saved rows, Manila timestamps, write-once |
| `tests/scan-performance.test.js` | Reuse skips work that a new notice would do |
| `tests/search.test.js` | SVP row selection |
| `tests/notice-date-filter.test.js` | Homepage date filtering |
| `tests/date-format.test.js` | Month-first date display |
| `tests/review.test.js` | Review list and decisions |
| `tests/list.test.js` | Saved notice listing helpers |
| `tests/reclassify.test.js`, `tests/reclassify-title.test.js` | Reclassify leaves manual decisions alone |
| `tests/classification-context.test.js` | Structured-field classification before download |
| `tests/classifier-false-positives.test.js`, `tests/classifier-review-reduction.test.js` | Known title patterns |
| `tests/pdf-lifecycle.test.js` | PDF text and OCR handoff |
| `tests/ocr-worker.test.js` | OCR page limits and timeouts |
| `tests/docx.test.js`, `tests/xlsx.test.js` | Those extractors |
| `tests/software-requirements.test.js` | Requirement fields and provenance |
| `tests/technical-summary.test.js` | Summary uses stored extra fields only, keeps clause text out of the summary, case report matches |
| `tests/improvements.test.js`, `tests/oct6-regression.test.js` | Regression cases from earlier fixes |

A passing suite means these checks passed on the machine that ran them. It does not mean every live PhilGEPS notice will classify correctly.

Extraction status (`complete`, `partial`, `needs_review`) and the notice IDs used as extraction examples are explained in [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) sections 8 and 16. This file does not repeat that narrative.

## Classification limitations

`classifyText` is a keyword and context matcher (`src/classification/relevance.js` plus `config/relevance.json`). It is not a language model.

- A title about hardware, catering, training, consulting, or connectivity is meant to be not relevant even if the word "software" appears incidentally.
- Mixed hardware and software, or mixed consulting and a real software purchase, is meant to land in `review`.
- A new product name that is not in the term list can be missed or sent to review.
- Manual classification (`classificationSource: "manual"`) is kept on later scans. `--reclassify` does not overwrite it.
- Title-level `skip` during a scan does not write `data/output/<id>.json`. A hardware decision made later inside `processNotice` does write a not-relevant packet. Those notices then appear on the homepage. Title-only skips appear only in that scan's report.

Human review is intentional. The tool does not treat `software` as a bid decision.

## Document extraction and OCR

- PDF text is a stream of positioned strings (`src/extraction/pdf.js`). Tables, headings, and page numbers are not reconstructed. Requirement `page` is usually null.
- `.docx` uses mammoth. `.xlsx` uses the `xlsx` package. Other types throw `UNSUPPORTED_DOCUMENT`.
- OCR runs for PDFs without a text layer. Language is English. Classification reads at most 6 pages and may stop early. Requirement extraction reads at most 20. A page that exceeds `OCR_PAGE_TIMEOUT_MS` (default 8 seconds) keeps the text gathered so far. The whole OCR run uses `OCR_TIMEOUT_MS` (default 15 seconds).
- OCR can drop or confuse words. Packets record `usedOcr` on the document. The original file remains the source.
- Scanned pages that are mostly blank are skipped by a pixel sample, which can also skip a page that is only a faint scan.

## Technical Requirements Summary

The summary is display-only (`frontend/src/requirements/technical-summary.js`). It does not reclassify and it does not edit saved JSON.

It shows license type or edition, subscription duration, and deployment when those stored fields exist and are not already the item block's product, quantity, unit, or license count. Empty extra fields produce the sentence "No additional technical fields were extracted. Review the original source documents."

The clause archive can include contract sentences. `extractTechnical` checks a keyword on a numbered block, then `splitMergedRequirements` splits sentences without checking the keyword again. The archive stays collapsed (40 clauses per page) so that text remains available without being presented as a specification. The case PDF prints the clause count, not the clause bodies.

Source labels are "PhilGEPS" or "Document 01" style names. They are not a guarantee that a human verified the field. Confidence is whatever the extractor stored, often `medium`.

## Saved notice reuse and historical reports

- Reuse requires a manual classification, or a packet that already has `requirements` and `relevance` (`noticeScanPlan`).
- Reused notices are `alreadyProcessed`. They are not counted again as new software, new review, or new not relevant.
- `matchingSoftware` still includes them when the saved classification is software (`isRelevant` and not `needsReview`).
- `writeScanReport` refuses to replace `data/output/scan-reports/<startedAt>.json`. Older files keep the counts and wording from the day they were written. An older report may omit `matchingSoftware`; the report UI falls back to the opportunity list length.
- Homepage cards count saved packets, not the latest scan. With no published-date filter they count every saved date. A published-date filter narrows the cards. Done software notices stay in the software total. The featured strip hides done software.

## Print and PDF

Daily and case reports are HTML views. Saving a PDF uses the browser print dialog. `@page` is A4 portrait (`frontend/src/reports/print.css`). The on-screen toolbar is hidden when printing.

CSS cannot remove the browser's own header and footer (URL, date, title). The reviewer clears "Headers and footers" in Chromium's print dialog. The app does not print its own page number. A CSS page counter was removed because it rendered as page 0.

The printed case report uses the same technical summary as the screen. It does not print the full clause archive.

## Security and operations

These points are what the code does. They are not a penetration test.

- The API has no authentication. It is intended for localhost. Do not expose port 3000 on a public network without adding access control. That control is not in the repository.
- `getNoticeDocument` resolves the file under `data/documents/<id>/` and returns 400 when the path escapes that folder.
- Scan report ids must be digits. Other ids are treated as missing.
- `.env` is gitignored. `.env.example` has no secrets. Do not put passwords in logs or docs.
- `data/documents`, `data/output`, and `data/logs` are gitignored. They can contain procurement documents. Do not commit them.
- PhilGEPS requests use a normal browser User-Agent, a delay, a timeout, and one retry. The client does not log in and does not store cookies for a session.
- One notice error does not delete other saved files. A failed report write does not roll back notice JSON already saved.

## Phase 3 — NOT IMPLEMENTED

Legacy PhilGEPS (`https://notices.philgeps.gov.ph`) is planned only. There is no `src/philgeps-legacy/` package, no legacy route, and no scan mode for that host.

`docs/V2_IMPLEMENTATION_PLAN.md` describes a possible later adapter: public abstract fields, separate ids so legacy files cannot overwrite modern `data/output/<digits>.json` files, and no change to the classifier or OCR for that work. None of that adapter is in the running application. Do not treat the plan as current behavior.

## Possible later improvements

These are gaps visible from the current code, not a committed schedule.

- A legacy public-notice adapter, only after the Phase 3 plan is explicitly started.
- Page and table structure in PDF extraction, so technical fields can cite a page.
- A second keyword check after sentence splits, so contract clauses are less likely to enter the technical archive. That would be an extraction change and needs its own review. The current summary does not do this.
- Authentication and a real deployment layout, if the API ever leaves the developer's machine.
