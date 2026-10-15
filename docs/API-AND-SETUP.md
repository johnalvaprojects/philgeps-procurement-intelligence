# Developer guide

Setup for a new developer on this repository. Commands were taken from `package.json`, `frontend/package.json`, and the route files.

## Prerequisites

- Node.js `>=22.13.0` (`package.json` `engines`).
- npm, which ships with Node.js.
- A network path to `https://philgeps.gov.ph` when you run a real scan. Tests do not need that site.
- Windows, macOS, or Linux. OCR uses `@napi-rs/canvas`, which ships native binaries for common platforms.

There is no database to install.

## Install

From the project root:

```bash
npm install
```

Then the interface:

```bash
cd frontend
npm install
```

Copy `.env.example` to `.env` in the project root if you want to override the defaults. The server starts without a `.env` file and uses the defaults in code.

## Dependencies

Root `package.json` dependencies:

| Package | Used for |
|---------|----------|
| `express` 5 | HTTP API |
| `cheerio` | PhilGEPS HTML parsing |
| `pdfjs-dist` | PDF text |
| `tesseract.js` | OCR |
| `@napi-rs/canvas` | Rendering PDF pages for OCR |
| `mammoth` | DOCX text |
| `xlsx` | Spreadsheet text |

Frontend: React 19, Vite 8, `@vitejs/plugin-react`. The frontend has no test script.

## Package scripts

Root:

| Script | Command | Purpose |
|--------|---------|---------|
| `npm start` | `node src/index.js` | CLI. With no args it prints usage |
| `npm test` | `node --test` | All files in `tests/` |
| `npm run dev` | `node --watch-path=./src --watch-path=./config src/server/server.js` | API with restart on `src/` and `config/` changes |

Frontend, from the `frontend/` directory:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server, proxies `/api` to port 3000 |
| `npm run build` | Production bundle in `frontend/dist/` |
| `npm run preview` | Serves the built bundle locally |

`npm test` must be run from the project root. The frontend package has no test script.

## Environment variables

Names and purposes only. Do not commit `.env`.

| Name | Purpose |
|------|---------|
| `PORT` | API port. Code default `3000`. Not listed in `.env.example` |
| `PHILGEPS_BASE_URL` | Public site origin. Default `https://philgeps.gov.ph` |
| `REQUEST_DELAY_MS` | Pause between PhilGEPS requests. Default `1000` |
| `REQUEST_TIMEOUT_MS` | HTTP timeout. Default `45000` |
| `OCR_TIMEOUT_MS` | Whole OCR run budget. Default `15000` |
| `OCR_PAGE_TIMEOUT_MS` | Optional per-page OCR budget. Not listed in `.env.example`. If unset or invalid, the code uses `8000` or `OCR_TIMEOUT_MS`, whichever is smaller. A valid integer is used as entered |
| `USER_AGENT` | `User-Agent` header on PhilGEPS requests. Default is a Chrome-like string in `src/philgeps/client.js` |
| `NODE_ENV` | Elevated guest access is possible only when this is exactly `development` or `demo`. `production`, an unset value, and any other value keep guests restricted |
| `GUEST_FULL_ACCESS` | Must be exactly `true`, together with a permitted `NODE_ENV`, before a guest receives staff workspace access. Unset, `false`, and any other value stay restricted. This cannot enable elevated guest access in production or when `NODE_ENV` is unset. `npm run dev`, `npm run visual`, and Docker Compose do not set it |
| `COOKIE_SECURE` | `true` or `false` forces the session cookie Secure flag. Leave unset for local HTTP |
| `SESSION_TTL_MS` | Session length. Default 12 hours |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MS` | Staff sign-in limit. Default 5 attempts per 15 minutes |
| `API_PROXY_TARGET` | Vite proxy target. Default `http://localhost:3000`. Docker Compose sets `http://api:3000` |

## Run the app

Terminal 1, project root:

```bash
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`. API health check: `http://localhost:3000/api/status`.

Welcome offers guest entry and staff sign-in. A guest is restricted unless `GUEST_FULL_ACCESS=true` and `NODE_ENV` is `development` or `demo`. Do not expose that development server to the public internet: an elevated guest can run scans, change classifications, and edit Awarded to Us markings. Staff accounts live in `data/auth/` and are not committed.

Sign-in, Continue as guest, and Sign out play a short television channel transition. Reduced motion skips it. A failed sign-in stays on the welcome form.

## Docker Compose

Local development only. It does not replace `npm run dev`.

Requires Docker Desktop. Ports 3000 and 5173 must be free. The API image is Node 22 on Debian Bookworm and includes the Linux libraries used by `@napi-rs/canvas`. OCR still uses `tesseract.js` inside Node.

```bash
docker compose up -d
docker compose logs -f
docker compose ps
docker compose down
```

`api` publishes `localhost:3000`. `web` publishes `localhost:5173` and proxies `/api` to `http://api:3000`. The project folder and `./data` are bind-mounted, so scan files stay on the host. Linux `node_modules` are Docker volumes, separate from a Windows install. `docker compose down` does not delete `./data`.

Stop the containers before starting `npm run dev` on the same ports.

## Tests and frontend build

```bash
npm test
cd frontend
npm run build
```

## API

Dates in scan bodies are `YYYY-MM-DD`. Notice ids are digits.

### `GET /api/status`

`200`

```json
{ "status": "ok", "name": "PhilGEPS Automation" }
```

### `GET /api/notices`

`200` array. One object per `data/output/<digits>.json`.

```json
[
  {
    "referenceNumber": "94419",
    "title": "Example title",
    "organization": "Example agency",
    "postedDate": "October 6, 2026",
    "deadline": null,
    "abc": null,
    "classification": "software",
    "classificationSource": "automatic",
    "reviewed": false,
    "workStatus": "new"
  }
]
```

`workStatus` is present for software packets. `publicWorkStatus` returns `new` when a software packet has no stored status. `unread` is true when the shared read map has a recorded baseline and this notice id is not in it. Listing notices does not mark them read.

### `POST /api/notices/:id/read`

Requires a signed-in reader and the `x-csrf-token` header.

`200` `{ "noticeId", "read": true, "unread": false }`. The notice JSON is not rewritten.

`401` when no session is present. `403` when the CSRF header is missing. `404` when that saved notice does not exist.

### `GET /api/notices/:id`

`200` the saved packet. When `data/output/<id>.requirements.json` exists, the response also has `extractedRequirements`.

`404` `{ "error": "Notice not found" }`

### `GET /api/notices/:id/documents`

`200` array of `{ "filename", "url" }`. `url` is `/api/notices/<id>/documents/<filename>`. `metadata.json` is omitted.

`404` `{ "error": "No documents found for this notice" }` when the folder is missing. The case page treats that 404 as an empty document list.

### `GET /api/notices/:id/documents/:filename`

`200` the file bytes (`res.sendFile`).

`400` `{ "error": "Invalid document path" }` if the resolved path leaves the notice folder.

`404` `{ "error": "Document not found" }`

### `PATCH /api/notices/:id/classification`

Body:

```json
{ "classification": "software" }
```

Allowed values are `software`, `review`, and `not relevant`.

`200` includes `classification`, `classificationSource` (`manual`), `reviewed`, `reviewedAt`, `review`, `relevance`, and `workStatus`.

`400` invalid decision or id. `404` no saved notice.

### `PATCH /api/notices/:id/work-status`

Body:

```json
{ "workStatus": "in-progress" }
```

Allowed values: `new`, `in-progress`, `done`.

`200` returns the notice classification fields and `workStatus`. `400` or `404` on invalid input or a missing file.

### `GET /api/company-awards`

Staff, or a development or demo guest with `fullAccess: true`. A restricted guest and a production guest receive `403`.

`200`

```json
{
  "records": [],
  "note": "Internal markings. These records are not a confirmation from PhilGEPS."
}
```

Each record copies the notice reference, title, and organization, plus `awardNoticeNumber`, `acceptanceStatus` (`pending`, `accepted`, or `unknown`), and `philgepsConfirmed: false`. The award URL is built from the number. The server does not fetch PhilGEPS.

### `PUT /api/company-awards/:noticeId`

Body: `{ "awardNoticeNumber": "99097334", "acceptanceStatus": "unknown" }`. The number is 1 to 12 digits and must be unique across markings. Requires the CSRF header. The saved notice file is not modified.

`400` for a bad number or status. `404` when the notice file is missing. `403` for a restricted or production guest, or a missing CSRF token.

### `DELETE /api/company-awards/:noticeId`

Requires the CSRF header. Removes that marking only.

### `POST /api/scan`

No body: default window (today and the previous three Manila publish days).

```json
{ "from": "2026-10-05", "to": "2026-10-08" }
```

`202`

```json
{ "status": "started", "from": "2026-10-05", "to": "2026-10-08" }
```

`400` uses one of these messages from `parseScanRangeBody`: `Both from and to are required`, `from and to must be valid YYYY-MM-DD dates`, or `from must be on or before to`. There is no maximum number of days.

`409` `{ "error": "A scan is already running" }`

### `GET /api/scan/status`

`200` progress. Fields include `running`, `from`, `to`, `noticesDiscovered`, `noticesProcessed`, `currentReferenceNumber`, `softwareCount`, `reviewCount`, `notRelevantCount`, `alreadyProcessedCount`, `errorCount`, `documentsDownloaded`, `elapsedMs`, `complete`, `completionReason`, `startedAt`.

`running` in this response is the controller flag, not only the progress object.

### `GET /api/scan/reports`

`200` array of summaries: `id`, `startedAt`, `finishedAt`, `from`, `to`, `mode`, `complete`, `completionReason`, `durationMs`, `counts`. `listScanReports` sorts by `startedAt` descending. Unreadable JSON files are skipped.

### `GET /api/scan/reports/:id`

`id` must be digits (`startedAt`). `200` is the full report, including `softwareOpportunities` and `errors`.

`404` `{ "error": "Scan report not found" }` for a missing file or an id that is not all digits.

### Report body (written to disk)

```json
{
  "id": "1791454820171",
  "startedAt": 1791454820171,
  "finishedAt": "2026-10-08T02:00:00.000Z",
  "generatedAt": "2026-10-08T02:00:01.000Z",
  "from": "2026-10-05",
  "to": "2026-10-08",
  "mode": "scan",
  "durationMs": 120000,
  "complete": true,
  "completionReason": "date-boundary",
  "counts": {
    "discovered": 10,
    "processed": 10,
    "software": 1,
    "review": 0,
    "notRelevant": 4,
    "alreadyProcessed": 5,
    "errors": 0,
    "documentsDownloaded": 2,
    "matchingSoftware": 3
  },
  "softwareOpportunities": [
    {
      "referenceNumber": "94419",
      "title": "Example",
      "organization": "Example agency",
      "source": "automatic",
      "reviewStatus": "pending",
      "previouslySaved": true
    }
  ],
  "errors": []
}
```

The numbers above are a shape example, not a live report. `matchingSoftware` counts new and previously saved software. `counts.software` counts only newly classified software.

## File storage

All of these are gitignored except `.gitkeep` placeholders:

| Path | Contents |
|------|----------|
| `data/output/<id>.json` | Saved notice packet |
| `data/output/<id>.requirements.json` | Extracted requirements |
| `data/output/<id>.extracted.txt` | Extracted text |
| `data/output/scan-reports/<startedAt>.json` | One immutable scan report |
| `data/output/svp-batch.json` | Latest scan row list |
| `data/output/review.html` | Legacy static review page |
| `data/documents/<id>/` | Original downloads and `metadata.json` |
| `data/logs/` | Scan logs |
| `data/notice-reads/reads.json` | Shared read map for saved notices |
| `data/company-awards/markings.json` | Awarded to Us markings |
| `data/auth/` | Staff account and session files |

Do not commit downloaded procurement files or generated case data.

## CLI

`node src/index.js` from the project root:

| Command | Effect |
|---------|--------|
| `<id>` or a PhilGEPS notice URL | Process that one notice |
| `--scan` | Same windowed scan as the API, in the foreground |
| `--svp 5` | Process at most 5 latest SVP notices |
| `--reclassify` | Reclassify saved packets. Manual decisions stay |
| `--reclassify-title` | Title-only reclassify. `--dry-run` prints without writing |
| `--extract-requirements [id]` | Rebuild requirements JSON for software packets |
| `--list` | Write `data/output/review.html` |
| `--review` | Serve that HTML page on this computer |
| `--decide <id> software` | Manual classification. Also `review` or `not relevant` |
| `--reviewed <id>` | Mark reviewed and keep the first reviewed time |

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Vite page has no notices | API not running, or `GET http://localhost:3000/api/status` fails. Vite only proxies `/api`. In Docker the proxy target is `http://api:3000` |
| `409` on scan | A scan is already running. Wait for `GET /api/scan/status` to show `running: false` |
| `400` on scan | The page checks dates before POST. One date without the other, a date that is not a real calendar day, or From after To never leaves the browser. The API returns 400 only if that body still arrives: `Both from and to are required`, `from and to must be valid YYYY-MM-DD dates`, or `from must be on or before to`. There is no maximum span. Both dates empty uses today and the three previous Asia/Manila publish days |
| Scan stops with `complete: false` | `completionReason` is `repeated-page`, `safety-limit`, or `error`. The report lists what was collected |
| OCR errors on install | `@napi-rs/canvas` native binary. Use Node 22 on a supported platform and reinstall |
| `npm test` fails in `frontend/` | Run it from the repository root |
| Document link says unavailable | The file is not in `data/documents/<id>/`. The UI does not substitute another file |
| Printout shows a URL and date | Those come from the browser print dialog. Turn off headers and footers there |
| Port 3000 in use | Set `PORT` or stop the other process |

## Deployment

Docker Compose above is for local development. It is not a hosted deployment. `npm run build` only builds the frontend. Downloaded files stay on local disk under `data/`. Treat a shared public deployment as out of scope.
