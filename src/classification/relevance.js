function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term) {
  const words = term.trim().split(/\s+/).map(escapeRegExp);
  const body = words.join('\\s+');
  return new RegExp(`\\b${body}s?\\b`, 'i');
}

const CONNECTIVITY = /\b(?:internet|broadband|wi-?fi|leased\s+lines?|connectivity)\b/i;
const TITLE_STOP_WORDS = new Set([
  'supply', 'delivery', 'procurement', 'purchase', 'services', 'service', 'project',
  'various', 'other', 'with', 'from', 'that', 'this', 'and', 'for', 'the', 'lot',
  'one', 'use', 'used', 'through', 'additional', 'requirements', 'provision',
]);
const INCIDENTAL_SOFTWARE = [
  /\bquality management information system\b/gi,
  /\bno software required\b/gi,
  /\bsoftware assisted\b/gi,
  /\bediting software\b/gi,
  /\bsoftware\s*\/\s*tools\b/gi,
  /\bsoftware\s+and\s+equipment\b/gi,
  /\bon\s+(?:[a-z0-9]+\s+){1,4}software\b/gi,
];
const SECURITY_PRODUCTS = [
  ['Web Application Firewall', /\bweb application firewalls?\b/i],
  ['WAF', /\bwafs?\b/i],
  ['cloud access security broker', /\bcloud access security brokers?\b/i],
  ['CASB', /\bcasb\b/i],
  ['cloud security', /\bcloud security\b/i],
  ['endpoint security', /\bendpoint security\b/i],
  ['antivirus', /\banti-?virus\b/i],
  ['threat protection', /\bthreat protection\b/i],
  ['security software', /\bsecurity software\b/i],
  ['cybersecurity', /\bcyber-?security\b/i],
  ['firewall', /\bfirewalls?\b/i],
];
const NON_SOFTWARE_PROCUREMENT = [
  ['accommodation', /\baccommodations?\b/i],
  ['a function hall', /\bfunction halls?\b/i],
  ['electrical equipment', /\belectrical equipment\b/i],
  ['electrical supplies', /\belectrical supplies\b/i],
  ['electrical supplies', /\belectrical tape\b/i],
  ['signage', /\bsignage\b/i],
];
const PHYSICAL_PROCUREMENT = [
  ['food or catering', /\b(?:catering|meals\s+and\s+snacks|food\s+packs|school[-\s]based\s+feeding)\b/i],
  ['construction or civil works', /\b(?:fencing|school\s+buildings|classrooms?|pavements?|asphalt|concreting|roofing)\b/i],
  ['safety or field supplies', /\b(?:safety\s+gears?|\bppe\b|survey\s+supplies)\b/i],
  ['office or janitorial consumables', /\b(?:janitorial\s+supplies|bond\s+paper|trash\s+bags?)\b/i],
  ['medical or laboratory supplies', /\b(?:medical\s+supplies|medicines?|laboratory\s+supplies)\b/i],
  ['ICT or physical hardware', /\b(?:ict\s+equipment|switches\s+and\s+cabling|personal\s+computers?|photocopiers?|external\s+hard\s+drives?|projectors?(?!\s+screens?\b)|smart\s+(?:tvs?|televisions?))\b/i],
];
const PROCUREMENT_ID = /\b(?:purchase request|pr)(?:\s+no\.?)?(?:\s*&\s*date)?\s*[:.]?\s*(\d{4}-\d{2}-\d{3,}|[A-Za-z]{2,}-[A-Za-z0-9-]+)/gi;

function isClearNotRelevant(relevance) {
  return relevance?.isRelevant === false && relevance?.needsReview === false;
}

export function downloadDecision(relevance) {
  if (isClearNotRelevant(relevance)) return 'skip';
  if (relevance?.category === 'software' && relevance.isRelevant === true) return 'download';
  return 'inspect';
}

export function shouldDownloadAll(decision, documentIsSoftware = false) {
  if (decision === 'download') return true;
  if (decision === 'inspect') return documentIsSoftware === true;
  return false;
}

export function inspectionDecision(relevance) {
  if (relevance?.category === 'software' && relevance.isRelevant === true) return 'software';
  if (isClearNotRelevant(relevance)) return 'skip';
  return 'unclear';
}

function connectivitySubscription(text, softwareTerms) {
  return softwareTerms.length > 0
    && softwareTerms.every((term) => term.toLowerCase() === 'subscription')
    && CONNECTIVITY.test(text);
}

export function stripIncidentalSoftwareMentions(text) {
  let cleaned = String(text ?? '');
  for (const pattern of INCIDENTAL_SOFTWARE) {
    cleaned = cleaned.replace(new RegExp(pattern.source, 'gi'), ' ');
  }
  return cleaned;
}

function distinctiveTitleWords(noticeTitle) {
  const words = String(noticeTitle || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const kept = [];
  for (const word of words) {
    if (word.length < 5 || TITLE_STOP_WORDS.has(word) || kept.includes(word)) continue;
    kept.push(word);
  }
  return kept;
}

export function textAboutThisNotice(text, noticeTitle) {
  const cleaned = stripIncidentalSoftwareMentions(text);
  const words = distinctiveTitleWords(noticeTitle);
  if (words.length === 0) return cleaned;

  const parts = splitParts(cleaned);
  const related = parts.filter((part) => words.some((word) => termPattern(word).test(part)));
  return related.join('\n');
}

function splitParts(text) {
  return String(text ?? '').split(/\n+|(?<=[.!?])\s+|•/g).map((part) => part.trim()).filter(Boolean);
}

function procurementIdPattern() {
  return new RegExp(PROCUREMENT_ID.source, 'gi');
}

export function findProcurementIds(text) {
  const ids = [];
  for (const match of String(text ?? '').matchAll(procurementIdPattern())) {
    const id = match[1].toUpperCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function splitProcurementSections(text) {
  const source = String(text ?? '');
  const marks = [...source.matchAll(procurementIdPattern())];
  if (marks.length < 2) return [];

  const groups = new Map();
  for (let index = 0; index < marks.length; index += 1) {
    const id = marks[index][1].toUpperCase();
    const start = marks[index].index;
    const end = index + 1 < marks.length ? marks[index + 1].index : source.length;
    const chunk = source.slice(start, end);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(chunk);
  }

  return [...groups.entries()].map(([id, chunks]) => ({
    id,
    text: chunks.join('\n'),
  }));
}

function sectionScore(section, titleWords, ids, allSections) {
  if (ids.includes(section.id)) return 100;
  const shared = titleWords.filter((word) => allSections.every((item) => termPattern(word).test(item.text)));
  return titleWords.filter((word) => !shared.includes(word) && termPattern(word).test(section.text)).length;
}

export function selectProcurementSection(text, noticeTitle, context = {}) {
  const sections = splitProcurementSections(text);
  if (sections.length < 2) return { text, notes: [], uncertain: false };

  const ids = [
    ...findProcurementIds(noticeTitle),
    ...(context.identifiers || []).map((id) => String(id).toUpperCase()),
  ];
  const titleWords = distinctiveTitleWords(noticeTitle);
  const ranked = sections
    .map((section) => ({ ...section, score: sectionScore(section, titleWords, ids, sections) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score <= 0 || (second && best.score === second.score && best.score < 100)) {
    return {
      text: '',
      uncertain: true,
      notes: ['Could not match this notice to one procurement section, so it was left for review.'],
    };
  }

  const notes = [`Matched current procurement section using PR ${best.id}`];
  for (const section of sections) {
    if (section.id === best.id) continue;
    if (findTerms(section.text, context.softwareTerms || []).some((term) => term.toLowerCase() !== 'information system')) {
      notes.push(`Ignoring software term found in unrelated PR ${section.id}`);
    }
  }
  return { text: best.text, notes, uncertain: false };
}

function securityProduct(text) {
  for (const [label, pattern] of SECURITY_PRODUCTS) {
    if (pattern.test(text)) return label;
  }
  return '';
}

function matchingProcurement(text, families) {
  for (const [label, pattern] of families) {
    if (pattern.test(text)) return label;
  }
  return '';
}

function nonSoftwareProcurement(text) {
  return matchingProcurement(text, NON_SOFTWARE_PROCUREMENT);
}

function physicalProcurement(text) {
  return matchingProcurement(text, PHYSICAL_PROCUREMENT);
}

function strongSoftwareTerms(text, rules) {
  return findTerms(text, rules.softwareTerms).filter((term) => term.toLowerCase() !== 'information system');
}

function notRelevant(reason, notes = []) {
  return {
    isRelevant: false,
    needsReview: false,
    confidence: 0.9,
    category: 'not relevant',
    reasons: [reason],
    notes,
  };
}

function reviewResult(reason, notes = []) {
  return {
    isRelevant: false,
    needsReview: true,
    confidence: 0.4,
    category: 'unknown',
    reasons: [reason],
    notes,
  };
}

function withNotes(result, notes) {
  return { ...result, notes: [...(result.notes || []), ...notes] };
}

function itemText(text, rules) {
  const parts = splitParts(text);
  const itemParts = parts.filter((part) => nonSoftwareProcurement(part) || findTerms(part, rules.hardwareTerms).length > 0);
  if (itemParts.length === 0) return text;
  const softwareInItem = itemParts.some((part) => strongSoftwareTerms(part, rules).length > 0);
  if (softwareInItem) return text;
  return itemParts.join('\n');
}

export function classifyDocumentForNotice(text, rules, noticeTitle, context = {}) {
  const cleaned = stripIncidentalSoftwareMentions(text);
  const selected = selectProcurementSection(cleaned, noticeTitle, {
    ...context,
    softwareTerms: rules?.softwareTerms || [],
  });
  if (selected.uncertain) {
    return reviewResult('The document lists more than one procurement, and this notice could not be matched to one of them.', selected.notes);
  }

  const focused = itemText(selected.text, rules);
  return withNotes(classifyText(focused, rules), selected.notes);
}

export function findTerms(text, terms) {
  const source = String(text ?? '');
  return terms.filter((term) => termPattern(term).test(source));
}

function excerpt(text, term) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = termPattern(term).exec(source);
  if (!match) return null;

  const start = Math.max(0, match.index - 70);
  const end = Math.min(source.length, match.index + match[0].length + 70);
  let slice = source.slice(start, end).trim();
  if (start > 0) slice = `...${slice}`;
  if (end < source.length) slice = `${slice}...`;
  return slice;
}

function softwareNote(text, softwareTerms) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  const shown = compact.length > 0 && compact.length <= 180
    ? compact
    : softwareTerms.slice(0, 3).join(', ');
  return `Relevant software procurement detected: ${shown}`;
}

export function classifyText(text, rules) {
  const source = String(text ?? '');
  const softwareTerms = findTerms(source, rules.softwareTerms);
  const hardwareTerms = findTerms(source, rules.hardwareTerms);
  const security = securityProduct(source);
  if (security) {
    return notRelevant(
      `The procurement is a security product (${security}), not a software product.`,
      [`Security product detected: ${security}`],
    );
  }
  if (connectivitySubscription(source, softwareTerms)) {
    return notRelevant('The text describes a connectivity subscription, not a software product.');
  }

  const described = nonSoftwareProcurement(source);
  const strong = strongSoftwareTerms(source, rules);
  if (described && strong.length === 0) {
    return notRelevant(
      `The procurement describes ${described}, not a software product.`,
      [`Procurement describes ${described}`],
    );
  }
  if (described && strong.length > 0) {
    return reviewResult('The text mentions both a non-software procurement and software, so a person should check it.');
  }

  const physical = physicalProcurement(source);
  if (physical && strong.length === 0) {
    return notRelevant(
      `The procurement describes ${physical}, not a software product.`,
      [`Procurement describes ${physical}`],
    );
  }
  if (physical && strong.length > 0) {
    return reviewResult(
      'The text mentions both a physical procurement and software, so a person should check it.',
      [`Physical procurement detected: ${physical}`],
    );
  }

  if (softwareTerms.length > 0 && strong.length === 0 && hardwareTerms.length === 0) {
    return reviewResult('"information system" appears in the name, but the text does not show that software is the item being procured.');
  }

  const reasons = [];
  for (const term of softwareTerms.slice(0, 4)) {
    const quote = excerpt(source, term);
    reasons.push(quote ? `The text includes "${term}" in: ${quote}` : `The text includes "${term}".`);
  }
  for (const term of hardwareTerms.slice(0, 4)) {
    const quote = excerpt(source, term);
    reasons.push(
      quote
        ? `The text includes hardware term "${term}" in: ${quote}`
        : `The text includes hardware term "${term}".`
    );
  }

  if (softwareTerms.length > 0 && hardwareTerms.length === 0) {
    return {
      isRelevant: true,
      needsReview: false,
      confidence: softwareTerms.length >= 2 ? 0.9 : 0.75,
      category: 'software',
      reasons,
      notes: [softwareNote(source, softwareTerms)],
    };
  }

  if (hardwareTerms.length > 0 && softwareTerms.length === 0) {
    return {
      isRelevant: false,
      needsReview: false,
      confidence: 0.9,
      category: 'hardware',
      reasons,
      notes: ['Procurement describes hardware or other non-software goods.'],
    };
  }

  if (softwareTerms.length > 0 && hardwareTerms.length > 0) {
    reasons.push('Software and hardware terms both appear, so a person should check the line items.');
    return {
      isRelevant: false,
      needsReview: true,
      confidence: 0.5,
      category: 'mixed',
      reasons,
      notes: [],
    };
  }

  return {
    isRelevant: false,
    needsReview: true,
    confidence: 0.3,
    category: 'unknown',
    reasons: ['No configured software or hardware terms were found.'],
    notes: [],
  };
}

export function classifyWithoutDocument(text, rules) {
  const fromTitle = classifyText(text, rules);
  return {
    ...fromTitle,
    isRelevant: false,
    needsReview: true,
    confidence: 0.35,
    reasons: [
      'The attached document had no readable text, so only the notice title was checked. A person should open the saved file.',
      ...fromTitle.reasons,
    ],
  };
}
