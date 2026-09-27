# PhilGEPS software opportunity downloader

This tool finds public PhilGEPS Small Value Procurement notices, keeps the ones related to software, and downloads their public documents. Each notice has its own folder named with the PhilGEPS notice ID. The files inside keep their original PhilGEPS filenames.

A hardware title such as IT equipment is skipped and its files are not downloaded. If the title is unclear, the program reads the public document and keeps the file only when that document is a software purchase. An existing file is not overwritten.

The quotation stays in Trustera's existing process. This tool does not create a quotation, choose prices, submit a bid, or contact the agency.

## Run one notice

```bash
npm install
npm test
node src/index.js 85876
```

A full notice URL also works:

```bash
node src/index.js https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876
```

## Scan the last three days

```bash
node src/index.js --scan
```

This checks every Small Value Procurement notice whose PhilGEPS publish date is from three days ago through today. The date comes from the publish date on the public list, not from the notice number. A hardware title is skipped. A software title, or a vague title whose document is software, gets every public attachment in `data/documents/<notice id>/`.

## Run a small test batch

```bash
node src/index.js --svp 5
```

This is the short test. It processes at most the number you pass, such as 10, 20, or 50. Every Small Value Procurement notice counts, including hardware, software, unclear, already saved, and errors. It does not scan the full three-day window. The script waits about one second between requests.

## Reclassify saved notices

```bash
node src/index.js --reclassify
```

This reads the notice files already in `data/output` and applies the current classifier again. It does not start a new scan. A manual classification is left unchanged. Saved attachments are not deleted. A vague notice is checked from saved text when that text exists, and otherwise from one temporary attachment.

## Open the review list

```bash
node src/index.js --list
```

That writes `data/output/review.html` from the notices already saved. Open that file in a browser. A batch run and a single-notice run refresh the same page. Each notice shows the PhilGEPS ID, title, publish date, status, attachment count, and whether a person has checked it.

```bash
node src/index.js --review
```

That serves the same page on this computer so Mark Software, Mark Not Relevant, and Keep for Review can save a manual decision. A manual decision is stored on the notice JSON and is separate from an automatic classification. Downloaded files are left in place. The same decision can be saved from the command line:

```bash
node src/index.js --decide 87086 software
node src/index.js --decide 87086 not-relevant
node src/index.js --decide 87086 review
```

## Mark a notice reviewed

```bash
node src/index.js --reviewed 85876
```

This updates the saved notice and the review page. It does not download the notice again. `Checked` stays `pending` until that command is run. Running it again keeps the first reviewed time. A later run of the same notice keeps that reviewed mark.

Under the row, the page shows the requirements saved from the document: product or service, line items, delivery, certifications, ABC, and any other requirement that was found. A section that was not in the document is left out. When no line items were read, the extracted text is still linked.

## Output

- `data/output/85876.json` — one notice, its documents, relevance, and requirements. `review.status` stays `pending` until a person marks it reviewed.
- `data/output/85876.extracted.txt` — the text read from the PDF.
- `data/documents/85876/` — the original downloaded file. A kept notice also has `metadata.json` in that folder.
- `data/logs/` — one log file for each scan.
- `data/output/svp-batch.json` — the short list from a batch run.
- `data/output/review.html` — the same saved notices as a page a person can open.

A field that is not in the notice or the document is `null` or an empty list. Software and hardware words used for relevance live in `config/relevance.json`.

Settings are in `.env`. Copy `.env.example` if that file is missing. `.env` is not committed.

The current PDF reader uses the text stored in the file. When that text is missing, the program reads the scanned pages with OCR and saves what it could recognize. OCR stops after 15 seconds by default (`OCR_TIMEOUT_MS`). The notice is then marked for review and the scan continues. A notice that already has a saved classification is not inspected again. OCR can miss or mix up words, so `usedOcr` is recorded on the document and a person should still check the original file. A request-for-quotation layout that does not match the current table pattern can leave the line items empty.
