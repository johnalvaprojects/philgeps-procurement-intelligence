/** Provenance-aware field helpers for requirement extraction. */

export function sourced(value, source = null, extras = {}) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const {
    page = null,
    confidence = 'high',
    ...rest
  } = extras;
  return {
    value: typeof value === 'string' ? value.trim() : value,
    source: source || null,
    page: page == null ? null : page,
    confidence,
    ...rest,
  };
}

export function fieldValue(field) {
  return field == null ? null : field.value;
}

export function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

export function firstCapture(text, pattern) {
  const match = String(text ?? '').match(pattern);
  if (!match) return null;
  return cleanText(match[1] ?? match[0]);
}

/** Prefer the full match when group 1 would drop leading qualifiers. */
export function fullMatch(text, pattern) {
  const match = String(text ?? '').match(pattern);
  if (!match) return null;
  return cleanText(match[0]);
}

export function parseLooseNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const digits = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!digits) return null;
  const number = Number(digits[0]);
  return Number.isFinite(number) ? number : null;
}

export function normalizeMoney(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const match = cleaned.replace(/php/i, '').match(/[\d,]+(?:\.\d{2})?/);
  return match ? match[0].replace(/\s+/g, '') : cleaned;
}

/**
 * Parse a duration phrase while preserving semantic qualifiers.
 * Returns display value = original wording; adds quantity/unit/constraint for matching.
 */
export function parseDurationPhrase(text) {
  const originalText = cleanText(text);
  if (!originalText) return null;

  let constraint = null;
  const qualifier = originalText.match(
    /^(at\s+least|minimum(?:\s+of)?|no\s+less\s+than|more\s+than|up\s+to|no\s+more\s+than|maximum(?:\s+of)?|less\s+than)\b/i,
  );
  if (qualifier) {
    const raw = qualifier[1].toLowerCase();
    if (/at\s+least|minimum|no\s+less\s+than|more\s+than/.test(raw)) constraint = 'minimum';
    else if (/up\s+to|no\s+more\s+than|maximum|less\s+than/.test(raw)) constraint = 'maximum';
  }

  let quantity = null;
  let unit = null;
  const numeric = originalText.match(
    /(\d+)\s*[- ]?\s*(year|years|month|months|day|days|calendar\s+days?)\b/i,
  );
  const oneYear = originalText.match(/one\s*\(?\s*1\s*\)?\s*(year|years)\b/i);
  if (numeric) {
    quantity = Number(numeric[1]);
    unit = /year/i.test(numeric[2]) ? 'year' : /month/i.test(numeric[2]) ? 'month' : 'day';
  } else if (oneYear) {
    quantity = 1;
    unit = 'year';
  }

  return {
    originalText,
    constraint,
    quantity,
    unit,
  };
}

/** Build a sourced duration field; value stays the original phrase for display. */
export function durationField(text, source, extras = {}) {
  const parsed = parseDurationPhrase(text);
  if (!parsed) return null;
  return sourced(parsed.originalText, source, {
    confidence: extras.confidence || 'high',
    page: extras.page ?? null,
    constraint: parsed.constraint,
    quantity: parsed.quantity,
    unit: parsed.unit,
    originalText: parsed.originalText,
    ...extras,
  });
}

export function looksLikeSuspiciousEmail(email) {
  const value = cleanText(email);
  if (!value) return true;
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) return true;
  const lower = value.toLowerCase();
  // Common OCR corruptions — do not autocorrect.
  if (/(^|@)[^@]*amai[il]\.com$/.test(lower) && !/@gmail\.com$/.test(lower)) return true;
  if (/@gmai1\.com$|@gmial\.com$|@hotmai1\.com$|@yaho0\.com$/.test(lower)) return true;
  if (/secretariai|rfabac|fumished|dov\.ph/.test(lower)) return true;
  if (/\s/.test(value)) return true;
  return false;
}
