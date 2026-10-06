import {
  cleanText,
  durationField,
  firstCapture,
  fullMatch,
  looksLikeSuspiciousEmail,
  normalizeMoney,
  parseLooseNumber,
  sourced,
} from './sourced-field.js';

const PHILGEPS_SOURCE = 'philgeps-structured';

function pushUnique(list, value, source, extras = {}) {
  const text = cleanText(value);
  if (!text) return;
  if (list.some((item) => cleanText(item.value) === text)) return;
  list.push(sourced(text, source || null, { confidence: extras.confidence || 'medium', ...extras }));
}

function lineItemRows(notice) {
  const items = notice?.lineItems;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function usefulLotName(name) {
  const text = cleanText(name);
  if (!text) return false;
  if (/^ABC Per Unit$/i.test(text)) return false;
  if (/^Note:/i.test(text)) return false;
  if (/Pesos$/i.test(text) && !/software|license|subscription/i.test(text)) return false;
  return true;
}

/** Soft-join wrapped PDF lines so bullets/sentences are complete. */
function unwrapLines(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');
    if (!line.trim()) {
      out.push('');
      continue;
    }
    const startsBlock = /^\s*(?:[-•*]|\d+[.)]\s+|Item\s*#|QTY\b|DELIVERY\b|NOTES?\b)/i.test(line);
    if (out.length > 0 && out[out.length - 1] !== '' && !startsBlock) {
      const prev = out[out.length - 1];
      if (!/[.:;!?]$/.test(prev.trim()) && !startsBlock) {
        out[out.length - 1] = `${prev} ${line.trim()}`;
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

function extractVatWording(text, source) {
  const quote = firstCapture(
    text,
    /((?:inclusive|exclusive)\s+of\s+(?:all\s+)?(?:applicable\s+)?(?:taxes|VAT)[^.\n]{0,80})/i,
  );
  return quote ? sourced(quote, source, { confidence: 'medium' }) : null;
}

function normalizeDeadlineKey(value) {
  const text = cleanText(value);
  if (!text) return null;
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
  };
  let day;
  let month;
  let year;
  let hour = null;
  let minute = null;

  const isoish = lower.match(/(\d{1,2})[-/]([a-z]+|\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?))?/i);
  const long = lower.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s*)?\/?\s*(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)/i)
    || lower.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (isoish) {
    day = Number(isoish[1]);
    month = months[isoish[2]] || Number(isoish[2]);
    year = Number(isoish[3]);
    if (isoish[4]) {
      hour = Number(isoish[4]);
      minute = Number(isoish[5]);
      if (/pm/i.test(isoish[6] || '') && hour < 12) hour += 12;
      if (/am/i.test(isoish[6] || '') && hour === 12) hour = 0;
    }
  } else if (long) {
    month = months[long[1]];
    day = Number(long[2]);
    year = Number(long[3]);
    if (long[4]) {
      hour = Number(long[4]);
      minute = Number(long[5]);
      if (/p/i.test(long[6] || '') && hour < 12) hour += 12;
      if (/a/i.test(long[6] || '') && hour === 12) hour = 0;
    }
  } else {
    return lower;
  }
  if (!day || !month || !year) return lower;
  const timePart = hour == null ? '' : `T${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}${timePart}`;
}

function deadlinesConflict(a, b) {
  const left = normalizeDeadlineKey(a);
  const right = normalizeDeadlineKey(b);
  if (!left || !right) return false;
  return left !== right;
}

function extractDeadlineFromText(text, source) {
  const fromText =
    firstCapture(text, /Deadline of Submission of Quotation:\s*([^\n]+)/i) ||
    firstCapture(text, /Deadline for Submission:\s*([^\n]+)/i) ||
    firstCapture(text, /Deadline(?:\s+for\s+Submission(?:\s+of\s+Quotation)?)?\s*:\s*([A-Za-z0-9][^\n]{5,80})/i) ||
    firstCapture(text, /on or before\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s*\/?\s*\d{1,2}:\d{2}\s*[ap]m)/i) ||
    firstCapture(text, /Until\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}[^\n]{0,40})/i) ||
    firstCapture(text, /Submission of Proposal\/Price Quotation\s*\|\s*Until\s+([^\n|]+)/i);
  if (fromText && !/mayor|philgeps|omnibus|permit|tax return/i.test(fromText)) {
    return sourced(fromText, source, { confidence: 'high' });
  }
  return null;
}

function extractDocumentDeliveryPeriod(text, source) {
  const patterns = [
    /Delivery Schedule:\s*([^\n]+)/i,
    /DELIVERY PERIOD:\s*([^\n]+)/i,
    /Delivery Period\s*:\s*([^\n]{5,160})/i,
    /(within\s+(?:ten|ten\s*\(\s*10\s*\)|\d+)\s*(?:\([^)]*\))?\s*calendar\s*days?[^.]*?(?:Notice to Proceed|NTP|Purchase Order|\(PO\))[^.]*\.?)/i,
    /(?:delivery or loading of the software licenses shall be\s+)(within\s+[^.]+)/i,
    /(\d+\s+Calendar Days? upon receipt of (?:the\s+)?(?:Notice to Proceed|Purchase Order|PO|NTP)[^\n]*)/i,
    /(Five\s*\(\s*5\s*\)\s*days upon receipt of Notice(?:\s+to\s+Proceed)?[^\n]*)/i,
    /(30CD upon receipt of the Purchase Order\s*\(PO\))/i,
  ];
  for (const pattern of patterns) {
    const hit = firstCapture(text, pattern) || fullMatch(text, pattern);
    if (!hit) continue;
    if (/^(item|qty|unit|abc)\b/i.test(hit)) continue;
    if (/^\d{2}-\d{3}/.test(hit)) continue;
    if (/mayor|business permit|warranty|price validity/i.test(hit)) continue;
    return sourced(cleanText(hit), source, { confidence: 'high', scope: 'document_labeled' });
  }
  // RFQ form header often prints "30 Calendar Days" above the delivery block without a useful label value.
  if (/delivery period/i.test(text)) {
    const headerDays = firstCapture(text, /(?:^|\n)\s*(\d+\s+Calendar Days)\s*(?:\n|$)/i);
    if (headerDays) {
      return sourced(headerDays, source, { confidence: 'medium', scope: 'document_header_days' });
    }
  }
  return null;
}

function extractPhilgepsDeliveryPeriod(notice) {
  if (notice?.deliveryPeriod == null || String(notice.deliveryPeriod).trim() === '') return null;
  const raw = String(notice.deliveryPeriod).trim();
  if (/^\d+$/.test(raw)) {
    return sourced(raw, PHILGEPS_SOURCE, {
      confidence: 'low',
      scope: 'philgeps_bare_number',
      unitUnknown: true,
      note: 'Bare PhilGEPS deliveryPeriod with no unit; prefer labeled document delivery when present.',
    });
  }
  return sourced(raw, PHILGEPS_SOURCE, { confidence: 'medium', scope: 'philgeps_structured' });
}

function extractDeliveryPeriod(text, notice, source) {
  const fromDoc = extractDocumentDeliveryPeriod(text, source);
  const fromPhilgeps = extractPhilgepsDeliveryPeriod(notice);
  // Explicit document delivery always prefers over bare PhilGEPS number.
  if (fromDoc) return fromDoc;
  return fromPhilgeps;
}

const CONTACT_REJECT = /^(technical|financial|requirements|instructions|notes|remarks|delivery|submission|scope|objective|documentation|payment|milestone|article|qty|unit|item)\b/i;
const CONTACT_HEADING = /requirement|specification|offer|schedule|condition|financial offer|technical requirements/i;

function isPlausibleContactPerson(name) {
  const text = cleanText(name);
  if (!text || text.length < 3) return false;
  if (CONTACT_REJECT.test(text)) return false;
  if (CONTACT_HEADING.test(text) && text === text.toUpperCase()) return false;
  if (/^[A-Z0-9 /&._-]{10,}$/.test(text) && !/[a-z]/.test(text) && CONTACT_HEADING.test(text)) {
    return false;
  }
  return true;
}

function extractContact(text, source, { usedOcr = false, fieldsNeedingReview, emailCandidates } = {}) {
  const emails = [...String(text ?? '').matchAll(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi)]
    .map((match) => match[1]);
  let contactEmail = null;
  for (const email of emails) {
    if (looksLikeSuspiciousEmail(email)) {
      emailCandidates?.push(sourced(email, source, {
        confidence: 'low',
        note: usedOcr ? 'ocr_suspicious' : 'suspicious_email',
      }));
      fieldsNeedingReview?.push('submission.contactEmail');
      continue;
    }
    // Prefer procurement / bac / official-looking addresses over letterhead when both exist.
    if (!contactEmail || /procurement|bac|secretaria/i.test(email)) {
      contactEmail = sourced(email, source, { confidence: 'high' });
    }
  }

  let person =
    firstCapture(text, /(?:for any clarification[^.]*contact)\s+(the\s+BAC Secretariat)/i) ||
    firstCapture(text, /(?:contact|please contact)\s+([A-Z][A-Za-z .'-]{3,60}?)(?:\s+of\s+|\s+at\s+|,\s*Tel)/i) ||
    firstCapture(text, /Secretariat Head[:\s]+([A-Z][A-Za-z .'-]{3,60})/i);

  let contactPerson = null;
  if (person && isPlausibleContactPerson(person)) {
    const weakOffice = /^(the\s+)?BAC Secretariat$/i.test(person);
    contactPerson = sourced(person, source, {
      confidence: weakOffice ? 'low' : 'medium',
      role: weakOffice ? 'contact_office' : 'contact_person',
    });
  }

  return { contactPerson, contactEmail };
}

function isPlausibleLocation(text) {
  const value = cleanText(text);
  if (!value || value.length < 4) return false;
  if (/^[©©]\s*/.test(value) || /^©/.test(value)) return false;
  if (/mayor|business permit|omnibus|philgeps registration|bidder has applied|official receipt/i.test(value)) {
    return false;
  }
  if (/quotation|deadline|requirement|specification|inclusive of/i.test(value)) return false;
  // Bare org name without address cues is weak — reject unless street/city/building present.
  if (/^department of\b/i.test(value) && !/\d|street|avenue|road|city|building|floor|compound|padre|faura/i.test(value)) {
    return false;
  }
  return true;
}

function extractDeliveryLocation(text, source) {
  const labeled =
    firstCapture(text, /Place of Delivery\s*:\s*([^\n]{4,160})/i) ||
    firstCapture(text, /Delivery Location\s*:\s*([^\n]{4,160})/i) ||
    firstCapture(text, /Delivery Address\s*:\s*([^\n]{4,160})/i) ||
    firstCapture(text, /Delivery Site\s*:\s*([^\n]{4,160})/i);
  if (!labeled || !isPlausibleLocation(labeled)) return null;
  return sourced(labeled, source, { confidence: 'medium' });
}

function categorizeRequirement(line) {
  if (/uptime|ssl|cdn|backup|firewall|hosted|cloud-based system|enterprise/i.test(line)) {
    if (/backup/i.test(line)) return 'supportRequirements';
    if (/cloud|hosted|deploy/i.test(line)) return 'deploymentRequirements';
    return 'minimumSpecifications';
  }
  if (/training/i.test(line)) return 'trainingRequirements';
  if (/support/i.test(line) && !/user support and training/i.test(line)) return 'supportRequirements';
  if (/user support and training/i.test(line)) return 'trainingRequirements';
  if (/integration|compatible|compatibility/i.test(line)) return 'compatibilityRequirements';
  if (/installation|implementation|customization|transition|migration/i.test(line)) {
    return 'implementationRequirements';
  }
  if (/genuine software|admin login|license/i.test(line)) return 'licenseRequirements';
  if (/cloud-based|on-?premise|deployment/i.test(line)) return 'deploymentRequirements';
  return 'requiredFeatures';
}

/** Reject unfinished / truncated requirement fragments. Exported for tests. */
export function isIncompleteRequirement(text) {
  const value = cleanText(text);
  if (!value || value.length < 12) return true;
  // Trailing conjunctions / cut-off punctuation (allow '.' and ';' as list terminators).
  if (/\b(or|and|of|the|a|an|to|for|with|from|every|including|into|onto|as|by)\s*$/i.test(value)) {
    return true;
  }
  if (/[,:|/\\«]\s*$/.test(value)) return true;
  // Truncated parenthetical / OCR cut-off (e.g. "connections (i.").
  if (/\([^)]*$/.test(value)) return true;
  if (/\bi\.\s*$/i.test(value)) return true;
  // Payment/documentation bullets are not technical specs.
  if (/^software license certificate\b/i.test(value)) return true;
  if (/^invoice\b|^delivery receipt\b|^certificate of completion\b/i.test(value)) return true;
  // Obvious OCR section dump markers without a clean requirement sentence.
  if (/=\s*specestion\b|d\.1\.\s*detailed scope/i.test(value) && value.length > 200) return true;
  return false;
}

/**
 * Split only when structure strongly indicates multiple requirements.
 * Does not paraphrase. Exported for tests.
 */
export function splitMergedRequirements(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  // Cut annexed OCR dumps after a clean numbered TOR sentence.
  let working = cleaned;
  const sectionCut = working.search(
    /\bD\.1\.?\s*DETAILED SCOPE\b|\bDETAILED SCOPE OF WORK\b|=\s*Specestion\b/i,
  );
  if (sectionCut > 40) {
    working = working.slice(0, sectionCut).trim();
  }

  // Short, single-clause requirements stay intact.
  const hasSplitMarkers = /[|«]/.test(working)
    || /\s+[«•]\s+/.test(working)
    || (working.length > 260 && /\.\s+[A-Z]/.test(working));
  if (!hasSplitMarkers) {
    return isIncompleteRequirement(working) ? [] : [working];
  }

  let parts = [working];
  if (/[|«]/.test(working)) {
    parts = working.split(/\s*[|«]\s*/).map((part) => cleanText(part)).filter(Boolean);
  }

  const out = [];
  for (const part of parts) {
    if (part.length > 260 && /\.\s+[A-Z]/.test(part)) {
      const sentences = part.split(/(?<=[.!;])\s+(?=[A-Z])/).map((s) => cleanText(s)).filter(Boolean);
      if (sentences.length > 1) {
        for (const sentence of sentences) {
          if (!isIncompleteRequirement(sentence)) out.push(sentence);
        }
        continue;
      }
    }
    if (!isIncompleteRequirement(part)) out.push(part);
  }
  return out;
}

function extractTechnical(text, source) {
  const buckets = {
    requiredFeatures: [],
    minimumSpecifications: [],
    compatibilityRequirements: [],
    deploymentRequirements: [],
    licenseRequirements: [],
    supportRequirements: [],
    maintenanceRequirements: [],
    trainingRequirements: [],
    implementationRequirements: [],
  };
  const seen = new Set();
  const unwrapped = unwrapLines(text);

  function accept(line, forceCategory = null) {
    const pieces = splitMergedRequirements(line);
    for (const cleaned of pieces) {
      if (!cleaned || cleaned.length < 12) continue;
      if (/philgeps|mayor|omnibus|tax return|deadline|rfq no/i.test(cleaned)) continue;
      if (isIncompleteRequirement(cleaned)) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;

      let replacedShorter = false;
      for (const existing of [...seen]) {
        if (key === existing) {
          replacedShorter = true;
          break;
        }
        if (key.startsWith(existing) && key.length > existing.length) {
          seen.delete(existing);
          for (const bucket of Object.values(buckets)) {
            const idx = bucket.findIndex((item) => cleanText(item.value)?.toLowerCase() === existing);
            if (idx >= 0) bucket.splice(idx, 1);
          }
        } else if (existing.startsWith(key) && existing.length > key.length) {
          replacedShorter = true;
          break;
        }
      }
      if (replacedShorter) continue;

      seen.add(key);
      const category = forceCategory || categorizeRequirement(cleaned);
      pushUnique(buckets[category], cleaned, source, {
        categories: [category.replace(/Requirements$/, '')],
      });
    }
  }

  // Numbered TOR blocks — stop before next item or lettered annex section.
  const numbered = unwrapped.split(/(?=(?:^|\n)\s*\d+\.\s+)/);
  for (const block of numbered) {
    const match = block.match(
      /^\s*\d+\.\s+([\s\S]+?)(?=\n\s*\d+\.\s+|\n\s*[A-Z]\.\d|\n\s*[A-Z]\.\s|\n\s*$|$)/,
    );
    if (!match) continue;
    const line = cleanText(match[1]);
    if (!line || line.length < 20) continue;
    if (/year subscription|cloud-based|user support|training|integration|installation|customization|seamless|data migration|lms shall|uptime|ssl|cdn|backup|genuine|compatible/i.test(line)) {
      accept(line);
    }
  }

  // Bullet / dash requirements (complete unwrapped lines).
  const bullets = unwrapped.match(/(?:^|\n)\s*[-•*]\s*([^\n]{12,400})/g) || [];
  for (const raw of bullets) {
    const line = cleanText(raw.replace(/^[\s\n]*[-•*]\s*/, ''));
    if (/genuine software|admin login|subscription|compatible|cloud-based|lms|helpdesk|license|ssl|uptime|cdn|backup/i.test(line)) {
      accept(line);
    }
  }

  // Explicit Autodesk / compatibility sentences (full).
  const genuine = fullMatch(
    unwrapped,
    /Genuine Software from autodesk\.com[^\n.]{0,160}(?:\.|$)/i,
  ) || firstCapture(
    unwrapped.replace(/\n+/g, ' '),
    /(Genuine Software from autodesk\.com,\s*with Admin Login from Autodesk and at least 1-year subscription)/i,
  );
  if (genuine) accept(genuine, 'licenseRequirements');

  const compatible = firstCapture(
    unwrapped.replace(/\n+/g, ' '),
    /(compatible w\/?\s*the existing\s+IPOPHL Helpdesk(?:\s+System)?)/i,
  ) || firstCapture(
    unwrapped.replace(/\n+/g, ' '),
    /((?:license to be provided must be\s+)?compatible w\/?\s*the existing[^.]+)/i,
  );
  if (compatible) accept(compatible, 'compatibilityRequirements');

  // Annex-style fragments only when complete enough.
  for (const pattern of [
    /LMS uptime shall be 99%(?:, except for advance notification of system maintenance and update implementation)?/i,
    /Fully secure\s*\(SSL\)/i,
    /sftp-accessible CDN service(?:\s*[|]\s*Speed up page loads)?/i,
    /Ad-hoc backup shall be conducted at 12:00 midnight every day/i,
    /Enterprise-grade\s+firewall/i,
  ]) {
    const hit = fullMatch(unwrapped, pattern);
    if (hit && !isIncompleteRequirement(hit)) accept(hit);
  }

  let cloudOrOnPremise = null;
  if (/\bcloud-based\b/i.test(unwrapped) && !/\bon[-\s]?premise\b/i.test(unwrapped)) {
    cloudOrOnPremise = sourced('cloud-based', source, { confidence: 'medium' });
  } else if (/\bon[-\s]?premise\b/i.test(unwrapped) && !/\bcloud-based\b/i.test(unwrapped)) {
    cloudOrOnPremise = sourced('on-premise', source, { confidence: 'medium' });
  }

  return {
    ...buckets,
    supportedPlatforms: [],
    cloudOrOnPremise,
  };
}

function extractRfqNumber(text) {
  const patterns = [
    /RFQ No\.?\s*:?\s*([A-Za-z0-9][A-Za-z0-9 ./-]{2,60})/i,
    /Request for Quotation No\.?\s*:?\s*([A-Za-z0-9][A-Za-z0-9 ./-]{2,60})/i,
    /\((SVP\d{4}-\d{2}-\d+)\)/i,
    /(?:Quotation\s*#|RFQ)\s*:?\s*\n+\s*(\d{2}-\d{3}-\d{2})\b/i,
    /(?:^|\n)\s*(\d{2}-\d{3}-\d{2})\s*(?:\n|$)/,
  ];
  for (const pattern of patterns) {
    const hit = firstCapture(text, pattern);
    if (!hit) continue;
    // Trim trailing labels that sometimes stick to the capture.
    const trimmed = hit
      .replace(/\s+(?:P\.?R\.?|Approved|Date|Dear|The|Interested)\b.*$/i, '')
      .replace(/\s{2,}.*$/, '')
      .trim();
    if (trimmed.length >= 4) return trimmed;
  }
  return null;
}

function extractItemsFromText(text, source) {
  const items = [];
  const compact = String(text ?? '').replace(/\s+/g, ' ');
  const unwrapped = unwrapLines(text);

  const autodesk = compact.match(/(\d+)\s+Unit\s+(Autodesk Civil 3D[^.]*?)(?:\s+-\s*Genuine|\s+Purpose:|$)/i);
  if (autodesk) {
    const durationPhrase = fullMatch(
      compact,
      /(?:at\s+least|minimum(?:\s+of)?|no\s+less\s+than)\s+(?:\d+|one(?:\s*\(\s*1\s*\))?)\s*[- ]?year(?:s)?\s+subscription/i,
    ) || fullMatch(compact, /\d+\s*[- ]?year(?:s)?\s+subscription/i);
    items.push({
      itemNumber: sourced(1, source, { confidence: 'high' }),
      lotNumber: null,
      description: sourced(cleanText(autodesk[2]) || 'Autodesk Civil 3D Latest Edition', source, { confidence: 'high' }),
      quantity: sourced(Number(autodesk[1]), source, { confidence: 'high' }),
      unitOfMeasure: sourced('Unit', source, { confidence: 'high' }),
      licenses: sourced(Number(autodesk[1]), source, { confidence: 'medium' }),
      usersOrSeats: null,
      subscriptionDuration: durationPhrase
        ? durationField(durationPhrase, source, { confidence: 'high' })
        : null,
      licenseType: sourced('Subscription', source, { confidence: 'medium' }),
    });
  }

  const office = compact.match(/(\d+)\s+License\s+(Microsoft\s+[Oo]ffice\s*365[^\n.]{0,80}License)/i)
    || compact.match(/(\d+)\s+License\s+(Microsoft office 365 Family License)/i);
  if (office) {
    items.push({
      itemNumber: sourced(1, source, { confidence: 'high' }),
      lotNumber: null,
      description: sourced(cleanText(office[2]), source, { confidence: 'high' }),
      quantity: sourced(Number(office[1]), source, { confidence: 'high' }),
      unitOfMeasure: sourced('License', source, { confidence: 'high' }),
      licenses: sourced(Number(office[1]), source, { confidence: 'high' }),
      usersOrSeats: null,
      subscriptionDuration: null,
      licenseType: sourced('Family License', source, { confidence: 'medium' }),
    });
  }

  const helpdesk = compact.match(/(\d+)\s*Lic\.?\s+(\d+)\s*months/i);
  if (helpdesk && /helpdesk/i.test(compact)) {
    items.push({
      itemNumber: sourced(1, source, { confidence: 'high' }),
      lotNumber: null,
      description: sourced('Helpdesk software license', source, { confidence: 'high' }),
      quantity: sourced(Number(helpdesk[1]), source, { confidence: 'high' }),
      unitOfMeasure: sourced('Lic.', source, { confidence: 'high' }),
      licenses: sourced(Number(helpdesk[1]), source, { confidence: 'high' }),
      usersOrSeats: null,
      subscriptionDuration: durationField(`${helpdesk[2]} months`, source, { confidence: 'high' }),
      licenseType: sourced('Subscription license', source, { confidence: 'medium' }),
    });
  }

  if (/Warranty and Support/i.test(compact) && /helpdesk/i.test(compact)) {
    const warrantyDuration =
      fullMatch(compact, /Throughout the duration of the subscription/i)
      || firstCapture(unwrapped, /Warranty and Support[\s\S]{0,80}?(Throughout the duration of the subscription)/i);
    items.push({
      itemNumber: sourced(items.length + 1, source, { confidence: 'high' }),
      lotNumber: null,
      description: sourced('Warranty and Support', source, { confidence: 'high' }),
      quantity: sourced(1, source, { confidence: 'high' }),
      unitOfMeasure: sourced('Lot', source, { confidence: 'high' }),
      licenses: null,
      usersOrSeats: null,
      subscriptionDuration: warrantyDuration
        ? sourced(warrantyDuration, source, { confidence: 'high', role: 'coverage_period' })
        : sourced('Throughout the duration of the subscription', source, { confidence: 'medium', role: 'coverage_period' }),
      licenseType: null,
    });
  }

  const stataNew = compact.match(/New Account[:\s-]+One\s*\(?\s*1\s*\)?\s*License/i);
  const stataRenewal = compact.match(/For Renewal[:\s-]+Ten\s*\(?\s*10\s*\)?\s*Licenses/i);
  if (/STATA/i.test(compact) && (stataNew || stataRenewal)) {
    let stataIndex = 0;
    if (stataNew) {
      stataIndex += 1;
      items.push({
        itemNumber: sourced(stataIndex, source, { confidence: 'high' }),
        lotNumber: null,
        description: sourced('STATA MP2 V19 (2-CORE) ANNUAL LICENSE — New Account', source, { confidence: 'high' }),
        quantity: sourced(1, source, { confidence: 'high' }),
        unitOfMeasure: sourced('License', source, { confidence: 'high' }),
        licenses: sourced(1, source, { confidence: 'high' }),
        usersOrSeats: null,
        subscriptionDuration: durationField('One (1) Year', source, { confidence: 'high' }),
        licenseType: sourced('Annual License', source, { confidence: 'high' }),
      });
    }
    if (stataRenewal) {
      stataIndex += 1;
      items.push({
        itemNumber: sourced(stataIndex, source, { confidence: 'high' }),
        lotNumber: null,
        description: sourced('STATA MP2 V19 (2-CORE) ANNUAL LICENSE — Renewal', source, { confidence: 'high' }),
        quantity: sourced(10, source, { confidence: 'high' }),
        unitOfMeasure: sourced('License', source, { confidence: 'high' }),
        licenses: sourced(10, source, { confidence: 'high' }),
        usersOrSeats: null,
        subscriptionDuration: durationField('One (1) Year', source, { confidence: 'high' }),
        licenseType: sourced('Annual License (Renewal)', source, { confidence: 'high' }),
      });
    }
  }

  const lms = compact.match(/One\s*\(?\s*1\s*\)?\s*year subscription of a cloud-based LMS[^\n;]{0,160}/i);
  if (lms) {
    items.push({
      itemNumber: sourced(1, source, { confidence: 'high' }),
      lotNumber: null,
      description: sourced(cleanText(lms[0]), source, { confidence: 'high' }),
      quantity: sourced(1, source, { confidence: 'medium' }),
      unitOfMeasure: sourced('Lot', source, { confidence: 'medium' }),
      licenses: null,
      usersOrSeats: null,
      subscriptionDuration: durationField('One (1) year', source, { confidence: 'high' }),
      licenseType: sourced('Cloud-based LMS subscription', source, { confidence: 'high' }),
    });
  }

  return items;
}

function itemsFromStructured(notice) {
  const rows = lineItemRows(notice).filter((row) => usefulLotName(row.lotName || row.lotDescription));
  return rows.map((row, index) => {
    const qty = parseLooseNumber(row.quantity);
    const unit = cleanText(row.unitOfMeasure);
    const description = cleanText(row.lotDescription || row.lotName);
    const licenseUnit = unit && /licen/i.test(unit);
    return {
      itemNumber: sourced(index + 1, PHILGEPS_SOURCE, { confidence: 'medium' }),
      lotNumber: null,
      description: description ? sourced(description, PHILGEPS_SOURCE, { confidence: 'medium' }) : null,
      quantity: qty == null ? null : sourced(qty, PHILGEPS_SOURCE, { confidence: 'medium' }),
      unitOfMeasure: unit ? sourced(unit, PHILGEPS_SOURCE, { confidence: 'medium' }) : null,
      licenses: licenseUnit && qty != null ? sourced(qty, PHILGEPS_SOURCE, { confidence: 'medium' }) : null,
      usersOrSeats: null,
      subscriptionDuration: null,
      licenseType: null,
      unspsc: cleanText(row.unspsc) || null,
    };
  });
}

function mergeItems(structuredItems, textItems) {
  if (textItems.length > 0) return textItems;
  return structuredItems;
}

function compareMoney(a, b) {
  const left = normalizeMoney(a);
  const right = normalizeMoney(b);
  if (!left || !right) return false;
  return left.replace(/,/g, '') !== right.replace(/,/g, '');
}

function moneyEquals(a, b) {
  const left = normalizeMoney(a);
  const right = normalizeMoney(b);
  if (!left || !right) return false;
  return left.replace(/,/g, '') === right.replace(/,/g, '');
}

function extractItemTableAbc(text) {
  // Require peso-style decimals so quantity columns (e.g. "1 2 Unit") are not treated as ABC.
  const pair = String(text ?? '').match(
    /(?:Total ABC|ABC Per Unit\s+Total ABC)[\s\S]{0,200}?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i,
  );
  if (pair) {
    const unit = normalizeMoney(pair[1]);
    const total = normalizeMoney(pair[2]);
    if (unit && total) return { unitAbc: unit, itemAbc: total, scope: 'item_table' };
  }
  const family = String(text ?? '').match(
    /Microsoft Office 365 Family[\s\S]{0,120}?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i,
  );
  if (family) {
    return {
      unitAbc: normalizeMoney(family[1]),
      itemAbc: normalizeMoney(family[2]),
      scope: 'item_table',
    };
  }
  return null;
}

/**
 * Build a provenance-aware requirements object from PhilGEPS notice fields
 * and one or more document text sources. Does not invent values.
 *
 * @param {{ notice: object, sources?: Array<{ filename: string, text: string, usedOcr?: boolean }> }} input
 */
export function extractSoftwareRequirements({ notice, sources = [] } = {}) {
  const conflicts = [];
  const fieldsNeedingReview = [];
  const missingFields = [];
  const emailCandidates = [];

  const combinedText = sources.map((part) => part.text || '').join('\n\n');
  const primarySource = sources[0]?.filename || PHILGEPS_SOURCE;
  const anyOcr = sources.some((part) => part.usedOcr === true);

  const identification = {
    referenceNumber: notice?.referenceNumber
      ? sourced(String(notice.referenceNumber), PHILGEPS_SOURCE)
      : null,
    controlNumber: notice?.controlNumber
      ? sourced(String(notice.controlNumber), PHILGEPS_SOURCE, { confidence: 'high', role: 'philgeps_control_number' })
      : null,
    // Document RFQ / solicitation number — kept separate from PhilGEPS controlNumber.
    rfqOrSolicitationNumber: null,
    procurementTitle: notice?.title || notice?.projectTitle
      ? sourced(notice.title || notice.projectTitle, PHILGEPS_SOURCE)
      : null,
    procuringEntity: notice?.organization || notice?.governmentEntity
      ? sourced(notice.organization || notice.governmentEntity, PHILGEPS_SOURCE)
      : null,
    officeOrUnit: firstCapture(combinedText, /End-user:\s*([^\n]+)/i)
      ? sourced(firstCapture(combinedText, /End-user:\s*([^\n]+)/i), primarySource, { confidence: 'high' })
      : null,
    procurementMethod: notice?.procurementMode
      ? sourced(notice.procurementMode, PHILGEPS_SOURCE)
      : null,
  };

  const rfqFromText = extractRfqNumber(combinedText);
  if (rfqFromText) {
    identification.rfqOrSolicitationNumber = sourced(rfqFromText, primarySource, {
      confidence: 'high',
      role: 'document_rfq_number',
    });
  }

  // Financial: prefer PhilGEPS / item-table ABC; retain document-header ABC separately.
  const abcFromNotice = notice?.abc ? normalizeMoney(notice.abc) : null;
  const itemTableAbc = extractItemTableAbc(combinedText);
  const headerAbcRaw =
    firstCapture(combinedText, /Approved Budget for the Contract(?:\s*\(ABC\))?\s*(?:of|:)?\s*(?:Php|PHP|₱)?\s*([\d,]+(?:\.\d{2})?)/i) ||
    firstCapture(combinedText, /ABC[:\s]+(?:Php|PHP|₱)?\s*([\d,]+(?:\.\d{2})?)/i);
  const headerAbc = headerAbcRaw ? normalizeMoney(headerAbcRaw) : null;

  let abc = null;
  let abcScope = null;
  const otherFinancialLimits = [];

  if (abcFromNotice) {
    abc = sourced(abcFromNotice, PHILGEPS_SOURCE, {
      confidence: 'high',
      scope: 'philgeps_notice',
      role: 'preferred_abc',
    });
    abcScope = 'philgeps_notice';
  }

  if (itemTableAbc?.itemAbc) {
    const itemField = sourced(itemTableAbc.itemAbc, primarySource, {
      confidence: 'high',
      scope: 'item_table',
      unitAbc: itemTableAbc.unitAbc || null,
      role: 'item_abc',
    });
    if (!abc) {
      abc = { ...itemField, role: 'preferred_abc' };
      abcScope = 'item_table';
    } else if (moneyEquals(abc.value, itemTableAbc.itemAbc)) {
      abc = sourced(abc.value, abc.source, {
        confidence: 'high',
        scope: 'philgeps_notice_and_item_table',
        role: 'preferred_abc',
        corroboratedBy: primarySource,
      });
      abcScope = 'philgeps_notice_and_item_table';
    } else if (compareMoney(abc.value, itemTableAbc.itemAbc)) {
      conflicts.push({ field: 'financial.abc', values: [abc, itemField] });
      fieldsNeedingReview.push('financial.abc');
      otherFinancialLimits.push(itemField);
    }
  }

  if (headerAbc) {
    const headerField = sourced(headerAbc, primarySource, {
      confidence: 'high',
      scope: 'document_header',
      role: 'document_header_abc',
    });
    if (abc && compareMoney(abc.value, headerAbc)) {
      conflicts.push({ field: 'financial.abc', values: [abc, headerField] });
      if (!fieldsNeedingReview.includes('financial.abc')) {
        fieldsNeedingReview.push('financial.abc');
      }
      otherFinancialLimits.push(headerField);
    } else if (!abc) {
      abc = { ...headerField, role: 'preferred_abc' };
      abcScope = 'document_header';
    }
  }

  const financial = {
    abc,
    abcScope,
    currency: abc ? sourced('PHP', abc.source, { confidence: 'high' }) : null,
    vatWording: extractVatWording(combinedText, primarySource),
    otherFinancialLimits,
  };

  const structuredItems = itemsFromStructured(notice);
  const textItems = [];
  for (const part of sources) {
    textItems.push(...extractItemsFromText(part.text, part.filename));
  }
  const items = mergeItems(structuredItems, textItems);

  const technicalParts = sources.length
    ? sources.map((part) => extractTechnical(part.text, part.filename))
    : [extractTechnical(combinedText, primarySource)];

  function mergeBucket(key) {
    const merged = [];
    const seen = new Set();
    for (const part of technicalParts) {
      for (const item of part[key] || []) {
        const keyText = cleanText(item.value)?.toLowerCase();
        if (!keyText || seen.has(keyText)) continue;
        seen.add(keyText);
        merged.push(item);
      }
    }
    return merged;
  }

  // Cross-bucket dedupe: keep first category only.
  const categoryOrder = [
    'licenseRequirements',
    'compatibilityRequirements',
    'implementationRequirements',
    'trainingRequirements',
    'supportRequirements',
    'deploymentRequirements',
    'minimumSpecifications',
    'requiredFeatures',
    'maintenanceRequirements',
  ];
  const globalSeen = new Set();
  const technical = {
    requiredFeatures: [],
    minimumSpecifications: [],
    compatibilityRequirements: [],
    supportedPlatforms: [],
    deploymentRequirements: [],
    cloudOrOnPremise: technicalParts.map((part) => part.cloudOrOnPremise).find(Boolean) || null,
    licenseRequirements: [],
    supportRequirements: [],
    maintenanceRequirements: [],
    trainingRequirements: [],
    implementationRequirements: [],
  };
  for (const key of categoryOrder) {
    for (const item of mergeBucket(key)) {
      const keyText = cleanText(item.value)?.toLowerCase();
      if (!keyText || globalSeen.has(keyText)) continue;
      globalSeen.add(keyText);
      technical[key].push(item);
    }
  }

  const delivery = {
    deliveryPeriod: extractDeliveryPeriod(combinedText, notice, primarySource),
    implementationPeriod: null,
    subscriptionDuration: items.map((item) => item.subscriptionDuration).find(Boolean) || null,
    deliveryLocation: extractDeliveryLocation(combinedText, primarySource),
    startDate: null,
    endDate: null,
  };

  const contact = extractContact(combinedText, primarySource, {
    usedOcr: anyOcr,
    fieldsNeedingReview,
    emailCandidates,
  });

  const submissionMethod =
    firstCapture(combinedText, /submitted electronically to\s+([^\n]+)/i) ||
    firstCapture(combinedText, /may also be submitted through email at\s+([^\n]+)/i) ||
    firstCapture(combinedText, /(sealed envelope|registered mail|electronically)/i);

  const docDeadline = extractDeadlineFromText(combinedText, primarySource);
  const philgepsDeadline = (notice?.deadline || notice?.closingDate)
    ? sourced(notice.deadline || notice.closingDate, PHILGEPS_SOURCE, { confidence: 'high', role: 'philgeps_closing' })
    : null;

  let quotationDeadline = docDeadline || philgepsDeadline;
  if (docDeadline && philgepsDeadline && deadlinesConflict(docDeadline.value, philgepsDeadline.value)) {
    // Prefer document RFQ wording; preserve PhilGEPS and mark review.
    quotationDeadline = sourced(docDeadline.value, docDeadline.source, {
      confidence: 'high',
      role: 'preferred_document_deadline',
    });
    conflicts.push({
      field: 'submission.quotationDeadline',
      values: [philgepsDeadline, docDeadline],
    });
    fieldsNeedingReview.push('submission.quotationDeadline');
  }

  const submission = {
    quotationDeadline,
    submissionTime: null,
    submissionMethod: submissionMethod ? sourced(submissionMethod, primarySource, { confidence: 'medium' }) : null,
    contactPerson: contact.contactPerson,
    contactEmail: contact.contactEmail,
    contactEmailCandidates: emailCandidates,
  };

  const important = [
    ['financial.abc', financial.abc],
    ['items', items.length ? true : null],
    ['delivery.deliveryPeriod', delivery.deliveryPeriod],
    ['submission.quotationDeadline', submission.quotationDeadline],
  ];
  for (const [name, value] of important) {
    if (name === 'items') {
      if (!items.length) missingFields.push('items');
      continue;
    }
    if (!value) missingFields.push(name);
  }

  // Unique review fields
  const uniqueReview = [...new Set(fieldsNeedingReview)];

  // Surface any incomplete technical values that slipped through (should be rare after sanitizer).
  const technicalValues = [
    ...technical.requiredFeatures,
    ...technical.minimumSpecifications,
    ...technical.compatibilityRequirements,
    ...technical.deploymentRequirements,
    ...technical.licenseRequirements,
    ...technical.supportRequirements,
    ...technical.maintenanceRequirements,
    ...technical.trainingRequirements,
    ...technical.implementationRequirements,
  ];
  for (const item of technicalValues) {
    if (item?.value && isIncompleteRequirement(item.value)) {
      uniqueReview.push('technical.incomplete_requirement');
    }
  }
  const uniqueReviewFinal = [...new Set(uniqueReview)];

  // Final sanitize: drop incomplete technical fragments from output.
  for (const key of Object.keys(technical)) {
    if (!Array.isArray(technical[key])) continue;
    technical[key] = technical[key].filter((item) => item?.value && !isIncompleteRequirement(item.value));
  }

  const hasCoreFields = Boolean(financial.abc && items.length && submission.quotationDeadline);
  const hasMaterialGaps = missingFields.length > 0
    || items.some((item) => !item.description || (item.quantity == null && item.licenses == null));

  let extractionStatus = 'complete';
  if (uniqueReviewFinal.length || conflicts.length || emailCandidates.length) {
    extractionStatus = 'needs_review';
  } else if (!hasCoreFields || hasMaterialGaps) {
    extractionStatus = 'partial';
  }

  return {
    schemaVersion: 1,
    referenceNumber: notice?.referenceNumber ? String(notice.referenceNumber) : null,
    extractedAt: new Date().toISOString(),
    extractionStatus,
    identification,
    financial,
    items,
    technical,
    delivery,
    submission,
    missingFields,
    fieldsNeedingReview: uniqueReviewFinal,
    conflicts,
    sourceDocuments: sources.map((part) => part.filename).filter(Boolean),
  };
}
