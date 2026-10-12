# PhilGEPS Procurement Intelligence

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)](https://vite.dev/)

**PhilGEPS Procurement Intelligence** is a local tool for public [PhilGEPS](https://philgeps.gov.ph) Small Value Procurement notices. It finds software-related opportunities, reads their public documents, extracts procurement requirements with source provenance, and opens a review interface for classification and case detail. Built as a personal project — clone, run locally, and extend.

**Stack:** Node.js · Express · React · Vite · PDF, DOCX, and spreadsheet extraction · OCR for scanned pages

**My role:** Notice scanning and classification, document extraction and OCR, provenance-aware requirement extraction, the review API, and the React review interface (opportunity index, filters, search, pagination, and software case detail).

**Author:** [John Solomon M. Alvarez](https://github.com/johnalvaprojects)

## Status

V1 and V2 Phase 2 are implemented. Phase 3, legacy PhilGEPS at `notices.philgeps.gov.ph`, is planned and not built. See [docs/TESTING-AND-LIMITATIONS.md](docs/TESTING-AND-LIMITATIONS.md).

## Business problem

Public Small Value Procurement notices are published as web pages and attachments. A person looking for software licenses has to open each notice, skip hardware and services, and read bidding documents by hand. This project collects those public notices locally, separates likely software opportunities, and keeps the original documents next to the extracted fields so a reviewer can check the source before preparing a quotation.

The tool does not submit a bid, choose a price, or contact the agency.

## How it works

1. The React app asks the Express API to scan a publication-date window. The default window is today and the previous three publish days in Asia/Manila.
2. The scanner reads public PhilGEPS open-tender pages, keeps Small Value Procurement rows in that window, and skips notices it has already classified.
3. New notices are classified from the title, then from PhilGEPS fields, then from downloaded PDF, DOCX, or XLSX text. Scanned PDFs can use OCR.
4. Software notices get a requirements file. Saved packets update the homepage. Each finished scan writes one daily scan report.

The full path is in [docs/AUTOMATION-WORKFLOW.md](docs/AUTOMATION-WORKFLOW.md).

## Documentation

| Question | Read |
|----------|------|
| What problem this solves and why it was designed this way | [docs/PROJECT_DOCUMENTATION.md](docs/PROJECT_DOCUMENTATION.md) |
| How the current modules, files, and counts fit together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| What happens after Scan PhilGEPS, or after a direct CLI run | [docs/AUTOMATION-WORKFLOW.md](docs/AUTOMATION-WORKFLOW.md) |
| How to install, call the API, and troubleshoot | [docs/API-AND-SETUP.md](docs/API-AND-SETUP.md) |
| What tests cover, and what is not implemented | [docs/TESTING-AND-LIMITATIONS.md](docs/TESTING-AND-LIMITATIONS.md) |
| What V2 changed, and what Phase 3 would be | [docs/V2_IMPLEMENTATION_PLAN.md](docs/V2_IMPLEMENTATION_PLAN.md) |

`docs/PROJECT_DOCUMENTATION.md` is the design narrative. The four technical references describe the current implementation. Phase 3 in the plan is not built. If a detail disagrees with the code, those four references and the source are the current behavior. Sections marked **Superseded** in the older document are kept as history.

## Preview

![Procurement Intelligence homepage](docs/preview%201.png)

![Homepage in dark mode](docs/dark%20preview%201.png)

![Selected software opportunities](docs/preview%202.png)

![Notice list and date filter](docs/preview%203.png)

![Software case detail](docs/preview%204.png)

![Case review and work status](docs/preview%205.png)

![Daily scan reports](docs/dark%20preview%202.png)

![Printable daily scan report](docs/preview%20print.png)

---

## Quick start

Requires **Node.js 22**.

```bash
npm install
npm test
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The API listens on `http://localhost:3000`. The review page is the Vite app, usually `http://localhost:5173`, and it proxies `/api` to that server.

The same two processes can run in Docker. From the project root, with ports 3000 and 5173 free:

```bash
docker compose up -d
docker compose logs -f
```

Open `http://localhost:5173`. `docker compose down` stops the containers and leaves `data/` on this computer. `npm run dev` in two terminals still works when the containers are stopped. Only one program can use each port.

Copy `.env.example` to `.env` if that file is missing. `.env` is not committed. Downloaded documents, scan logs, sessions, and saved notice files stay in `data/` and are not committed either.

Merchant and Awards are archived. See [ARCHIVED_FEATURES.md](ARCHIVED_FEATURES.md).

---

## Features

- Scans public Small Value Procurement notices and separates software, review, and not-relevant titles
- Reads PDF, DOCX, and spreadsheet attachments, and uses OCR when a PDF has no text layer
- Extracts software procurement requirements into provenance-aware JSON (items, quantities, license terms, delivery, submission, technical specs)
- Keeps conflicting values visible instead of silently picking one (for example deadline or ABC scope conflicts)
- Case detail page for software notices: documents, extracted requirements, financial scope, review reasons, and OCR contact candidates
- Technical requirements summary for extra stored fields, with links to the original documents and the full extracted clause list kept available
- Review page with search, classification filters, date filters, and pagination
- Saved daily scan reports and a printable individual case report
- Separate work status for software opportunities: new, in progress, and done, kept across later scans
- Manual mark for software, not relevant, or keep for review
- Dark mode and a hold-to-scan control on the main page

This tool does **not** create a quotation, choose prices, submit a bid, match commercial products, or contact the agency.

---

## Project layout

| Path | Role |
|------|------|
| `src/philgeps/` | Public notice search, notice page parsing, and document download |
| `src/classification/` | Title and document classification, and the skip / reuse / process plan |
| `src/extraction/` | PDF, DOCX, XLSX text, OCR, and software requirement JSON |
| `src/server/` | Express API used by the React app |
| `src/scan.js` | Date-window scan and per-notice reuse or processing |
| `src/scan-reports.js` | Immutable daily scan report files |
| `frontend/` | React + Vite review interface, case page, and printable reports |
| `config/relevance.json` | Terms used to judge software and non-software titles |
| `tests/` | Node.js test runner checks |
| `tests/fixtures/technical-summary/` | Committed inputs for the technical summary tests |
| `Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` | Local Docker Compose setup for the API and Vite app |
| `archive/merchant-awards/` | Archived Merchant and Awards code. Not mounted on the running API |
| `data/documents/` | Original downloaded files (local only, not committed) |
| `data/output/` | Saved notice JSON, extracted text, requirements, and scan reports (local only) |
| `docs/` | Technical documentation and README screenshots |

---

## Commands

```bash
npm install
npm test
node src/index.js 85876
node src/index.js https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876
node src/index.js --scan
node src/index.js --svp 5
node src/index.js --reclassify
node src/index.js --reclassify-title [--dry-run]
node src/index.js --extract-requirements
node src/index.js --extract-requirements 92301
node src/index.js --list
node src/index.js --review
node src/index.js --decide 87086 software
node src/index.js --reviewed 85876
```

`--scan` checks Small Value Procurement notices whose PhilGEPS publish date is from three days ago through today. A hardware title is skipped. A software title, or an unclear title whose document is software, keeps its public attachments in `data/documents/<notice id>/`. An existing file is not overwritten. Software notices also get requirement extraction when processing succeeds.

`--svp 5` is the short test. It processes at most the number you pass. Every notice counts, including hardware, software, unclear, already saved, and errors. The script waits about one second between requests.

`--reclassify` reads notices already in `data/output` and applies the current classifier again. It does not start a new scan. A manual classification is left unchanged.

`--extract-requirements` rebuilds `data/output/<id>.requirements.json` for saved software notices (or one notice id). It prefers existing extracted text and does not invent missing values.

`--list` writes `data/output/review.html`. `--review` serves that page on this computer. `--decide` stores a manual decision on the notice JSON. `--reviewed` marks a notice checked and keeps the first reviewed time.

---

## Output

- `data/output/<id>.json` — notice packet (structured fields, documents, classification, work status)
- `data/output/<id>.extracted.txt` — text read from downloaded documents
- `data/output/<id>.requirements.json` — provenance-aware software requirements for the case page
- `data/documents/<id>/` — original downloaded files, plus `metadata.json` when the notice is kept
- `data/logs/` — one log file for each scan
- `data/output/svp-batch.json` — the short list from a batch run
- `data/output/review.html` — the saved notices as a page

A field that is not in the notice or the document is `null` or an empty list. Conflicts and low-confidence OCR candidates are recorded for human review instead of being silently resolved.

When a PDF has no text layer, OCR runs. Classification OCR can stop early once enough evidence exists; requirement extraction can read more of the document when needed. OCR can miss or mix up words, so `usedOcr` is recorded and the original file should still be checked.

---

## License

Licensed under the [MIT License](LICENSE).
