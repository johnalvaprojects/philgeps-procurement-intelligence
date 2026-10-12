# Merchant and Awards archive

These features are stored here until Trustera confirms how the dashboard should connect to the PhilGEPS Merchant account. The notice scanner, software classification, and reports stay in the active application. The archive switch remains `config/features.js`, with `awards` and `merchant` set to `true`.

The five verified Trustera awards were moved with `backend/merchant-seed.js` and were not edited.

## Archived features

- Trustera Merchant dashboard, including My Award Notices and Invitation to Bid
- Public Award Monitoring, including the award block inside a notice
- Offline Merchant importer
- Award and Merchant backend logic, routes, and tests
- Development invitation fixtures
- The five verified Trustera award records and their verification history

The live server does not mount `/api/awards`. Award batch polling lives in `frontend/Awards.jsx` and runs only when that page is mounted. The page is not mounted while the feature is archived.

## Folder

```
archive/merchant-awards/
  backend/     former src/awards/
  server/      award routes and controller
  frontend/    Merchant and Awards screens and awards.css
  tests/       award, supplier, Merchant, and importer tests
```

### backend/

| File | Role |
| --- | --- |
| `merchant-seed.js` | Five verified awards and history |
| `merchant-store.js` | Staff award storage, exact peso totals, history |
| `merchant-import.js` | Offline parser, deduplication, and status changes |
| `merchant-connection.js` | Fixed not-connected state |
| `invitation-fixtures.js` | Development samples, not Trustera invitations |
| `parse.js`, `retrieve.js`, `store.js`, `batch.js`, `service.js` | Public award checks |
| `supplier.js` | Trustera supplier matching for public awards |

### server/

| File | Role |
| --- | --- |
| `award-routes.js` | Staff and guest award routes. Merchant writes stay disabled inside this file. |
| `award-controller.js` | Handlers for public awards, batches, and Merchant reads |

### frontend/

| File | Role |
| --- | --- |
| `MerchantDesk.jsx` | My Award Notices and Invitation to Bid |
| `Awards.jsx` | Public Award Monitoring |
| `AwardPanel.jsx` | Award block inside a notice |
| `TrusteraAwards.jsx` | Earlier company register. It was already unmounted. |
| `awards.css` | Styles for these screens only |

### tests/

`awards.test.js`, `merchant-awards.test.js`, `merchant-import.test.js`, `supplier.test.js`

## Dependencies that stayed in the active application

These files are shared, so they were not moved.

| File | Why it stayed |
| --- | --- |
| `src/philgeps/client.js`, `src/philgeps/search.js` | Used by the notice scanner. Award retrieval and batch ordering import them. |
| `src/log.js` | Shared logging and delay helper. |
| `src/project-root.js` | Shared project path. Award storage still resolves `data/` from here. |
| `src/auth/middleware.js` | Staff and guest login for the whole application. |
| `frontend/src/api.js`, `frontend/src/format.js` | Shared by notices, reports, and the archived screens. |
| `frontend/src/components/OpportunityPager.jsx` | Used by the notice list. Public Award Monitoring also imports it. |
| `frontend/src/App.jsx`, `frontend/src/components/NoticeDetails.jsx`, `frontend/src/components/Header.jsx` | Active shell. They hide the archived screens through `config/features.js`. |
| `frontend/vite.config.js` | Resolves React for the archived screens, which sit outside the frontend package. |
| `frontend/src/App.css` | Active layout. It still contains unused `.site.is-awards` and `.site.is-merchant` rules. Removing them would be a separate style edit. |
| `tests/http-auth.js` | Shared test login helper. |
| `config/features.js` | Active archive switch. |
| `docs/` | Project documentation also describes the scanner and reports. |

## Preserved data

Do not edit these as part of a restore.

- `archive/merchant-awards/backend/merchant-seed.js`: awards 22316, 22247, 22249, 29475, and 16776, including amounts, acceptance, source URLs, and history.
- `data/merchant-awards/`: optional staff overlays. Gitignored. Not moved.
- `data/awards/`: stored public award checks. Gitignored. Not moved.
- `data/` notice and document files: not part of this archive and not modified.
- `invitation-fixtures.js`: sample rows only. The staff invitation API does not return them as account records.

## How to restore

1. In `config/features.js`, set `awards`, `merchant`, or both to `false`.
2. In `src/server/server.js`, import `archive/merchant-awards/server/award-routes.js` and mount it at `/api/awards` before the error handler.
3. Restart the API process. Reload the frontend.
4. `?view=awards` opens Award Monitoring. Staff `?view=merchant` opens Merchant.
5. Leave `merchant-seed.js` unchanged. Do not treat the five awards as a live PhilGEPS connection.

The screens already import the archived components. Restoring them does not require moving the files back.

## Intentionally left outside this folder

- The active notice scanner, classification, work status, and reports.
- `config/features.js`, so the running app can keep these features hidden.
- `data/awards/` and `data/merchant-awards/`, so stored checks and overlays stay on their existing paths.
- Shared helpers listed above.
- `docs/`, because those files also document the active scanner.
