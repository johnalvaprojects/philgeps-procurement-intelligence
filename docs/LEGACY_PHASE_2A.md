# Old PhilGEPS public reader, Phase 2A

Probed on 13 October 2026 against `https://notices.philgeps.gov.ph` only. No login, no attachment URL, no scan, and no writes under `data/`. The current scanner was not changed.

## Recommendation

Do not start Phase 2B. Public Detailed Search does not offer Small Value Procurement or notice status, and a publish-range submit did not return results.

Use a later open-notice reader with a hard page limit. It should read the public open list and public abstracts only, then stop. Wait for approval before building that reader.

## What works without signing in

The open search page answers a normal GET:

`/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?ClickFrom=OpenOpp&Result=3&menuIndex=3`

HTTP 200, about 100 KB, no login page. The first page had 20 notices. Row links look like `SplashBidNoticeAbstractUI.aspx?menuIndex=3&refID=<digits>&Result=3`.

A public abstract also answered HTTP 200. For `refID=13220462` the page exposed separate fields:

| Field | Sample |
| --- | --- |
| Reference Number | 13220462 |
| Procuring Entity | BARANGAY SANTISIMA CRUZ, STA. CRUZ, LAGUNA |
| Title | PURCHASE OF MOTOR VEHICLE- AMBULANCE |
| Area of Delivery | Laguna |
| Solicitation Number | SANTISIMA CRUZ 2026-004 |
| Procurement Mode | Public Bidding |
| Classification | Goods - General Support Services |
| Category | Vehicles |
| Approved Budget | PHP 1,400,000.00 |
| Contract Duration | 20 Day/s |
| Date Published | 13/10/2026 |
| Last Updated / Time | 13/10/2026 12:00 AM |
| Closing Date / Time | 23/10/2026 10:00 AM |
| Document Request List | 5 |

The page header date was Tuesday, October 13, 2026, so listing dates are day/month/year. This abstract had no line-item grid and no Quantity column. Line items must be read only when that grid is present. Do not invent rows when it is absent.

Document links on the abstract point at `ViewDocumentRequestList.aspx`. That URL was not requested. An earlier public check of it redirected to `log-in.aspx`. The reader must not follow it.

`robots.txt` is not published (HTTP 404). There is no crawl file to follow. Keep requests slow and capped anyway.

## Pagination

The open list is an ASP.NET form, `OpportunitiesSearchUI`. Moving pages is a POST of the hidden fields `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, `__EVENTTARGET`, and `__EVENTARGUMENT`.

The next control is `pgCtrlDetailedSearch$nextLB`. One next-page POST returned HTTP 200, 20 different reference numbers, and no overlap with the previous 20. The page dropdown on the open list ran through 553 pages. That is the full open list, not a Small Value slice. A reader must stop at a caller-supplied page limit.

There is no stable GET page number. Each next page needs the viewstate from the page just received. A failed or expired viewstate should stop the walk.

## Detailed Search

Opening Detailed Search is the postback `lbtnDetailed`. The form that comes back has:

- keyword
- category (goods and services categories, not procurement mode)
- location
- `datePickerDAvailableFrom$dateText` and `datePickerDAvailableTo$dateText`, labeled Publish Range
- must-have and must-not-have terms

It has no Small Value Procurement control and no notice-status control. Procurement mode and status show up later, on the abstract.

Two publish-range submits for 01/10/2026 through 02/10/2026 returned HTTP 200 and the same short page: "Transaction cannot be completed at this time." One submit left category and location blank. The other had accidentally posted the first category and location. Neither returned a result grid. Publish-range filtering is not reliable enough to build on.

## Dates, gaps, duplicates, failures

Store dates from the abstract, not from the list cell. The list puts the title, category, and agency in one cell. The abstract splits them. Normalize `DD/MM/YYYY` and `DD/MM/YYYY h:mm AM/PM` inside the legacy reader only, into the calendar text the app already stores. Do not teach the shared date parser to guess slash order.

Leave a missing line-item table, status, duration, or budget empty. The sample mode was Public Bidding, so a list row cannot be treated as Small Value until the abstract says so.

Deduplicate on `refID` within one walk. Keep the Phase 1 storage id `legacy-<refID>` so a legacy notice cannot replace a current numeric file. The same number may exist on both portals.

Retry a timed-out or HTTP 5xx request once, then record the failure and stop that walk. Treat the "Transaction cannot be completed" page as a failed request, not as an empty result. Do not keep posting after that page.

## Proposed reader

A separate legacy reader, not a change to `src/scan.js`, classification, OCR, or requirements extraction.

1. GET the open search page.
2. Read at most N pages. N is required and small. Advance with the next-page postback, waiting between requests.
3. GET each abstract on those pages. Skip any document or login URL.
4. Map public fields into the existing notice shape and set source `legacy` / Old PhilGEPS.
5. If the abstract's only document link is the request-list page, set `documentAccess` to `login-required` and download nothing. That status is the Phase 1 message. It must not be used when the abstract has no document link.
6. Do not write files until a later approved scanner says where a trial run may save `legacy-<refID>.json`.

Classification can use the title, category, description, and public line items when those items exist. OCR and requirements extraction stay unused when there is no public file.
