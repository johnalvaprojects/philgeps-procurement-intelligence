function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function licenseDuration(description) {
  if (/perpetual/i.test(description)) return 'Perpetual';
  const years = description.match(/(\d+)\s*year/i);
  if (years && /subscription/i.test(description)) return `${years[1]} Year Subscription`;
  if (years) return `${years[1]} Year`;
  if (/subscription/i.test(description)) return 'Subscription';
  return null;
}

function isBidderField(text) {
  return /name of company|name of store|receiver name|receiver account|receiver address|receiver email|receiver mobile|signature over printed|position\/designation|philgeps registration number|^tin\b/i.test(
    String(text ?? '')
  );
}

// The RFQ table puts the item number on its own line, then the description,
// then a line like "1 unit 320,000.00". Numbered rules such as "1. Bidders..."
// keep the period, so they are skipped. The item/project reference on the
// previous line is not the RFQ Control No.
export function parseLineItems(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\d{1,2}$/.test(lines[index])) continue;

    const window = lines.slice(index + 1, index + 8);
    const quantityOffset = window.findIndex((line) => /^\d+\s+\S+\s+[\d,]+\.\d{2}$/i.test(line));
    if (quantityOffset <= 0) continue;

    const description = clean(window.slice(0, quantityOffset).join(' '));
    if (!description || description.length > 300 || isBidderField(description)) continue;

    const quantityLine = window[quantityOffset].match(/^(\d+)\s+(\S+)\s+([\d,]+\.\d{2})$/i);
    const previous = lines[index - 1] || '';
    const itemReference = /^\d{4}-\d{2}-/.test(previous) ? previous : null;
    const sourceQuote = [itemReference, lines[index], description, window[quantityOffset]]
      .filter(Boolean)
      .join(' | ');

    items.push({
      itemNumber: lines[index],
      itemReference,
      reference: itemReference,
      description,
      name: description,
      quantity: Number(quantityLine[1]),
      unit: quantityLine[2],
      licenseDuration: licenseDuration(description),
      abcUnitCost: quantityLine[3],
      technicalSpecifications: [],
      requirements: [],
      sourceQuote,
    });
  }

  return items;
}

function firstMatch(text, pattern) {
  const match = String(text ?? '').match(pattern);
  return match ? clean(match[1] ?? match[0]) : null;
}

function cited(quote, sourceDocument) {
  return { text: quote, sourceQuote: quote, sourceDocument };
}

export function procurementPortion(text) {
  const source = String(text ?? '');
  const cut = source.search(/Omnibus Sworn Statement Form/i);
  return cut === -1 ? source : source.slice(0, cut);
}

function collectRequirements(portion, documentName) {
  const patterns = [
    /Price quotation\/s must be valid for a period of .+? from the deadline of submission/i,
    /Quotations exceeding the Approved Budget for the Contract shall be rejected\./i,
    /Award of contract shall be made to the lowest quotation which complies with the technical specifications[\s\S]+?stated herein\./i,
    /The item\/s shall be delivered according to the accepted offer of the bidder\./i,
    /Item\/s delivered shall be inspected[\s\S]+?technical specifications\./i,
    /Liquidated damages equivalent[\s\S]+?open to it\./i,
    /Bidders must state [“"]Comply[”"][\s\S]+?each Specification\./i,
    /Bidder shall state the brand and\/or model of the offered goods, if applicable\./i,
  ];
  const found = [];

  for (const pattern of patterns) {
    const quote = firstMatch(portion, pattern);
    if (quote && !isBidderField(quote)) found.push(cited(quote, documentName));
  }

  const submitByEmail = firstMatch(
    portion,
    /Quotations may also be submitted through email at\s+([\s\S]+?)\s+\./i
  );
  if (submitByEmail && !isBidderField(submitByEmail)) {
    found.push(cited(`Submit by email: ${submitByEmail}`, documentName));
  }

  return found;
}

export function buildRequirements({ notice, documentName, text }) {
  const portion = procurementPortion(text);
  const productOrService =
    firstMatch(portion, /intends to procure ["“](.+?)["”]/i) || notice.title || null;
  const rfqControlNumber = firstMatch(portion, /Control No\.\s*([A-Za-z0-9-]+)/i);

  const deadline =
    firstMatch(portion, /not later than\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i) ||
    notice.deadline ||
    null;

  const abc =
    firstMatch(portion, /Approved Budget for the Contract[\s\S]{0,180}?\(Php\s*([\d,]+\.\d{2})\)/i) ||
    notice.abc ||
    null;

  const requiredDocuments = [...portion.matchAll(/^\d+\.\s+(.+)$/gm)]
    .map((match) => clean(match[1]))
    .filter((line) => line && /permit|philgeps|omnibus|income tax/i.test(line))
    .filter((line) => !isBidderField(line))
    .map((line) => cited(line, documentName));

  const place = firstMatch(portion, /Place of Delivery:\s*(.+)/i);
  const period = firstMatch(portion, /(\d+\s+Calendar days upon receipt of PO\/JO)/i);
  const awarding = firstMatch(portion, /AWARDING:\s*(.+)/i);
  const paymentTerms = firstMatch(portion, /Payment Terms:\s*([\s\S]+?\.)/i);

  const deliveryRequirements = [];
  if (place) deliveryRequirements.push(cited(`Place of Delivery: ${place}`, documentName));
  if (period) deliveryRequirements.push(cited(period, documentName));

  const items = parseLineItems(portion).map((item) => ({
    ...item,
    sourceDocument: documentName || null,
  }));

  return {
    rfqControlNumber,
    productOrService,
    description: null,
    items,
    technicalSpecifications: [],
    requiredFeatures: [],
    scopeOfWork: [],
    supportRequirements: [],
    maintenanceRequirements: [],
    delivery: {
      period: period || null,
      place: place || null,
    },
    deliveryRequirements,
    awarding: awarding || null,
    paymentTerms: paymentTerms || null,
    requiredDocuments,
    certifications: requiredDocuments,
    requirements: collectRequirements(portion, documentName),
    abc,
    deadline,
    sourceDocuments: documentName ? [documentName] : [],
    sourceNoticeUrl: notice.url || null,
    otherRequirements: [],
  };
}

export function toProcurementDocument(requirements) {
  const source = requirements || {};
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    rfqControlNumber: source.rfqControlNumber ?? null,
    productOrService: source.productOrService ?? null,
    description: source.description ?? null,
    lineItems: items.map((item) => ({
      itemNumber: item.itemNumber ?? null,
      itemReference: item.itemReference ?? item.reference ?? null,
      description: item.description ?? item.name ?? null,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      licenseDuration: item.licenseDuration ?? null,
      abcUnitCost: item.abcUnitCost ?? null,
      technicalSpecifications: item.technicalSpecifications ?? [],
      requirements: item.requirements ?? [],
      sourceQuote: item.sourceQuote ?? null,
      sourceDocument: item.sourceDocument ?? null,
    })),
    delivery: {
      period: source.delivery?.period ?? null,
      place: source.delivery?.place ?? null,
    },
    awarding: source.awarding ?? null,
    paymentTerms: source.paymentTerms ?? null,
    requiredDocuments: source.requiredDocuments ?? [],
    requirements: source.requirements ?? [],
  };
}
