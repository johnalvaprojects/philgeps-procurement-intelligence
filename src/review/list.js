export function resultLabel(relevance) {
  if (!relevance || relevance.needsReview) return 'review';
  if (relevance.isRelevant) return 'relevant';
  return 'not relevant';
}

export function statusLabel(result) {
  if (result === 'error') return 'Error';
  if (result === 'relevant') return 'Software';
  if (result === 'not relevant') return 'Not Relevant';
  return 'Review';
}

export function fileHref(storedPath) {
  const normalized = String(storedPath || '').split('\\').join('/');
  if (normalized.startsWith('data/documents/')) {
    const relative = normalized.slice('data/'.length);
    return `../${encodePath(relative)}`;
  }
  if (normalized.startsWith('data/output/')) {
    return encodePath(normalized.slice('data/output/'.length));
  }
  return '';
}

function encodePath(value) {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export function rowFromPacket(packet) {
  const notice = packet?.notice || {};
  const documents = Array.isArray(packet?.documents) ? packet.documents : [];
  const files = [];
  const seenText = new Set();

  for (const document of documents) {
    const href = fileHref(document.localPath);
    if (href) files.push({ label: document.filename || 'file', href });
  }

  for (const document of documents) {
    const textHref = fileHref(document.extractedTextPath);
    if (textHref && !seenText.has(textHref)) {
      seenText.add(textHref);
      files.push({ label: 'extracted text', href: textHref });
    }
  }

  const noticeUrl = typeof notice.url === 'string' && notice.url.startsWith('https://') ? notice.url : '';
  const result = packet?.error ? 'error' : resultLabel(packet?.relevance);
  const savedFiles = documents.filter((document) => document?.localPath);

  return {
    referenceNumber: String(notice.referenceNumber || ''),
    organization: notice.organization || '',
    title: notice.title || '',
    postedDate: notice.postedDate || '',
    result,
    status: statusLabel(result),
    deadline: notice.deadline || '',
    noticeUrl,
    files,
    attachmentCount: savedFiles.length || documents.length,
    classificationSource: packet?.classificationSource === 'manual' ? 'manual' : 'automatic',
    reviewStatus: packet?.review?.status === 'reviewed' ? 'reviewed' : 'pending',
    packet: packetFromRequirements(packet?.requirements),
  };
}

function requirementTexts(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => (typeof item === 'string' ? item : item?.text)).filter(Boolean);
}

export function packetFromRequirements(requirements) {
  const source = requirements || {};
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    productOrService: source.productOrService || '',
    abc: source.abc || '',
    deadline: source.deadline || '',
    rfqControlNumber: source.rfqControlNumber || '',
    awarding: source.awarding || '',
    paymentTerms: source.paymentTerms || '',
    deliveryPlace: source.delivery?.place || '',
    deliveryPeriod: source.delivery?.period || '',
    items: items.map((item) => ({
      name: item?.description || item?.name || '',
      itemReference: item?.itemReference || item?.reference || '',
      quantity: item?.quantity ?? '',
      unit: item?.unit || '',
      licenseDuration: item?.licenseDuration || '',
      abcUnitCost: item?.abcUnitCost || '',
    })),
    technicalSpecifications: requirementTexts(source.technicalSpecifications),
    requiredFeatures: requirementTexts(source.requiredFeatures),
    scopeOfWork: requirementTexts(source.scopeOfWork),
    supportRequirements: requirementTexts(source.supportRequirements),
    maintenanceRequirements: requirementTexts(source.maintenanceRequirements),
    deliveryRequirements: requirementTexts(source.deliveryRequirements),
    certifications: requirementTexts(source.certifications),
    requiredDocuments: requirementTexts(source.requiredDocuments),
    requirements: requirementTexts(source.requirements),
    otherRequirements: requirementTexts(source.otherRequirements),
  };
}

export function packetsToRows(packets) {
  return packets
    .map(rowFromPacket)
    .filter((row) => row.referenceNumber)
    .sort((a, b) => Number(b.referenceNumber) - Number(a.referenceNumber));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function resultClass(result) {
  if (result === 'relevant') return 'software';
  if (result === 'not relevant') return 'not-relevant';
  if (result === 'error') return 'error';
  return 'review';
}

export function renderReviewList(rows, generatedAt = new Date()) {
  const body = rows.length === 0
    ? '<p>No saved notices yet.</p>'
    : rows.map(renderCard).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PhilGEPS review list</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 24px; color: #1a1a1a; background: #f6f7f9; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .note, .decision-note { max-width: 46rem; color: #333; }
    a, button { font: inherit; }
    a { color: #0b57d0; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .card h2 { font-size: 16px; margin: 0 0 8px; }
    .title { margin: 0 0 12px; }
    .facts { display: grid; grid-template-columns: 11rem 1fr; gap: 4px 12px; margin: 0 0 12px; }
    .facts dt { color: #555; }
    .facts dd { margin: 0; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    .software, .relevant { color: #0b6b2f; background: #e8f6ee; }
    .review { color: #8a5a00; background: #fff6e5; }
    .not-relevant { color: #333; background: #eee; }
    .error { color: #8d1d1d; background: #fdecec; }
    .reviewed { color: #0b6b2f; font-weight: 600; }
    .pending { color: #555; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
    .actions a, .actions button { border: 1px solid #c8c8c8; background: #fff; border-radius: 6px; padding: 6px 10px; text-decoration: none; color: #1a1a1a; cursor: pointer; }
    .files a { display: block; }
    .packet dl { display: grid; grid-template-columns: 11rem 1fr; gap: 4px 12px; margin: 0 0 8px; }
    .packet dt { color: #555; }
    .packet dd { margin: 0; }
    .packet ul { margin: 0; padding-left: 1.1rem; }
    table.items { border-collapse: collapse; width: auto; margin: 8px 0; }
    table.items th, table.items td { border: 1px solid #ddd; text-align: left; vertical-align: top; padding: 8px; }
    .empty { color: #555; margin: 8px 0 0; }
  </style>
</head>
<body>
  <h1>PhilGEPS review list</h1>
  <p class="note">Saved notices for a person to check. The details under each notice come from the document. An empty section was not found there. Agency ABC is the budget in the notice, not a quotation price. Preparing the quotation stays in Trustera's existing process.</p>
  <p class="decision-note" data-decision-note>Open this page with <code>node src/index.js --review</code> to use Mark Software, Mark Not Relevant, and Keep for Review. From a saved file, those buttons show the matching command.</p>
  <p>${rows.length} saved notice${rows.length === 1 ? '' : 's'}. Updated ${escapeHtml(generatedAt.toISOString())}.</p>
  ${body}
  <script>
    document.querySelectorAll('[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        const noticeId = button.getAttribute('data-notice');
        const decision = button.getAttribute('data-decision');
        const note = document.querySelector('[data-decision-note]');
        try {
          const response = await fetch('/api/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noticeId, decision }),
          });
          if (!response.ok) throw new Error(await response.text());
          window.location.reload();
        } catch (error) {
          if (note) note.textContent = 'Could not save from this page. Run: node src/index.js --decide ' + noticeId + ' ' + decision;
        }
      });
    });
  </script>
</body>
</html>
`;
}

function renderCard(row) {
  const files = Array.isArray(row.files) ? row.files : [];
  const documentLinks = files.filter((file) => file.label !== 'extracted text' && file.href);
  const fileLinks = files.map((file) => `<a href="${escapeHtml(file.href)}">${escapeHtml(file.label)}</a>`).join('');
  const openDocuments = documentLinks.length === 0
    ? ''
    : `<a href="${escapeHtml(documentLinks[0].href)}">Open Documents</a>`;
  const decisions = row.result === 'review'
    ? `<button type="button" data-notice="${escapeHtml(row.referenceNumber)}" data-decision="software">Mark Software</button>
       <button type="button" data-notice="${escapeHtml(row.referenceNumber)}" data-decision="not-relevant">Mark Not Relevant</button>
       <button type="button" data-notice="${escapeHtml(row.referenceNumber)}" data-decision="review">Keep for Review</button>`
    : '';
  const notice = row.noticeUrl
    ? `<a href="${escapeHtml(row.noticeUrl)}">PhilGEPS</a>`
    : '';
  const reviewStatus = row.reviewStatus === 'reviewed' ? 'reviewed' : 'pending';
  const status = row.status || statusLabel(row.result);
  const statusClass = resultClass(row.result);
  const attachmentCount = row.attachmentCount ?? documentLinks.length;
  const attachmentLabel = `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;

  return `<article class="card">
    <h2>Notice ${escapeHtml(row.referenceNumber)}</h2>
    <p class="title">${escapeHtml(row.title)}</p>
    <dl class="facts">
      <dt>Publish date</dt><dd>${escapeHtml(row.postedDate || '')}</dd>
      <dt>Status</dt><dd><span class="badge ${statusClass}">${escapeHtml(status)}</span></dd>
      <dt>Attachments</dt><dd>${escapeHtml(attachmentLabel)}</dd>
      <dt>Reviewed</dt><dd class="${escapeHtml(reviewStatus)}">${escapeHtml(reviewStatus)}</dd>
      <dt>Classification source</dt><dd>${escapeHtml(row.classificationSource || 'automatic')}</dd>
      <dt>Agency</dt><dd>${escapeHtml(row.organization || '')}</dd>
      <dt>Deadline</dt><dd>${escapeHtml(row.deadline || '')}</dd>
      <dt>Notice</dt><dd>${notice}</dd>
    </dl>
    <p class="actions">${openDocuments}${decisions}</p>
    <div class="files">${fileLinks}</div>
    ${renderPacket(row.packet)}
  </article>`;
}

const PACKET_SECTIONS = [
  ['technicalSpecifications', 'Technical specifications'],
  ['requiredFeatures', 'Required features'],
  ['scopeOfWork', 'Scope of work'],
  ['supportRequirements', 'Support'],
  ['maintenanceRequirements', 'Maintenance'],
  ['deliveryRequirements', 'Delivery'],
  ['certifications', 'Certifications'],
  ['otherRequirements', 'Other requirements'],
];

function renderPacket(packet = {}) {
  const parts = [];

  if (packet.productOrService) {
    parts.push(renderFact('Product or service', packet.productOrService));
  }
  if (packet.rfqControlNumber) parts.push(renderFact('RFQ control number', packet.rfqControlNumber));
  if (packet.abc) parts.push(renderFact('ABC', packet.abc));
  if (packet.deadline) parts.push(renderFact('Deadline in the document', packet.deadline));
  if (packet.deliveryPlace) parts.push(renderFact('Place of delivery', packet.deliveryPlace));
  if (packet.deliveryPeriod) parts.push(renderFact('Delivery period', packet.deliveryPeriod));
  if (packet.awarding) parts.push(renderFact('Awarding', packet.awarding));
  if (packet.paymentTerms) parts.push(renderFact('Payment terms', packet.paymentTerms));

  const facts = parts.length === 0 ? '' : `<dl>${parts.join('')}</dl>`;
  const items = Array.isArray(packet.items) ? packet.items : [];
  const itemTable = items.length === 0
    ? '<p class="empty">No line items were read from this document. Use the extracted text.</p>'
    : `<table class="items">
        <thead>
          <tr>
            <th>Item</th>
            <th>Item reference</th>
            <th>Quantity</th>
            <th>Unit</th>
            <th>License duration</th>
            <th>Agency ABC</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(renderItem).join('')}
        </tbody>
      </table>`;

  const documentLists = renderList('Required documents', packet.requiredDocuments);
  const requirementLists = renderList('Procurement requirements', packet.requirements);
  const covered = new Set();
  if (packet.deliveryPlace || packet.deliveryPeriod) covered.add('deliveryRequirements');
  if ((packet.requiredDocuments || []).length > 0) covered.add('certifications');
  const lists = PACKET_SECTIONS
    .filter(([key]) => !covered.has(key) && Array.isArray(packet[key]) && packet[key].length > 0)
    .map(([key, label]) => renderList(label, packet[key]))
    .join('');

  return `<div class="packet">${facts}${itemTable}${documentLists}${requirementLists}${lists}</div>`;
}

function renderList(label, values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  return `<p><strong>${escapeHtml(label)}</strong></p><ul>${values.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
}

function renderFact(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function renderItem(item) {
  return `<tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.itemReference)}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${escapeHtml(item.unit)}</td>
            <td>${escapeHtml(item.licenseDuration)}</td>
            <td>${escapeHtml(item.abcUnitCost)}</td>
          </tr>`;
}
