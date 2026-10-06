function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term) {
  const words = term.trim().split(/\s+/).map(escapeRegExp);
  const body = words.join('\\s+');
  return new RegExp(`\\b${body}s?\\b`, 'i');
}

const TELECOM_SERVICE = /\b(?:internet|broadband|wi-?fi|leased\s+lines?|connectivity|mobile\s+data|data\s+(?:plan|subscription|service)|telecom(?:munications?)?|sim\s+cards?|cellular\s+(?:plan|service|subscription)|prepaid\s+load)\b/i;
const SOFTWARE_SUBSCRIPTION_CONTEXT = /\b(?:software|licen[cs]es?|saas|applications?|\bapps?\b|platforms?|adobe|microsoft|azure|office\s*365|eviews?|acrobat|framemaker|pdf\s+editing|development\s+tools?|productivity|project\s+management|enterprise\s+ai|squash(?:\s*tm)?|cloud\s+service\s+provider|\bcsp\b|system\s+development|digital\s+platform|enterprise\s+software|web\s+application|mobile\s+application|database\s+system|information\s+system|canva|zoom(?:\s+workplace)?|capcut|nitro\s*pdf|google\s+drive|google\s+workspace|padlet|claude|sketchups?)\b/i;
const WEAK_SOFTWARE_TERMS = new Set(['subscription', 'information system']);
// License alone is not enough; require a software-ish object and no hardware bundle.
const LICENSE_SOFTWARE_OBJECT = /\b(?:softwares?|applications?|databases?|platforms?)\b/i;
const HARDWARE_BUNDLE = /\b(?:laptops?|desktops?|computers?|it\s+equipment|ict\s+equipment|personal\s+computers?|servers?|tablets?(?!\s+(?:form|dose|sy\b|for\b)))\b/i;
// Clear software-as-product cues (not bare "software" in a mixed title).
const DEDICATED_SOFTWARE_PRODUCT = /\b(?:software\s+licen[cs]es?|licen[cs]es?\s+of\s+software|statistical\s+software|helpdesk\s+software|it\s+helpdesk\s+software|productivity\s+software|project\s+management\s+software|cad(?:d)?\s+software|auto\s*cad|engineering\s+(?:design\s+)?software|architectural(?:\/design)?\s+software|enterprise\s+software|application\s+software|database\s+software|video\s+editing\s+software|pdf\s+editing|microsoft\s+365|office\s*365|autodesk|civil\s*3d|stata|eviews?|adobe\s+acrobat|saas|web\s+application\s+development|mobile\s+application\s+development|software\s+customization|software\s+maintenance|software\s+support|learning\s+management\s+system)\b/i;
// Connectivity / satellite kits override bare "software" wording in mixed titles.
const CONNECTIVITY_HARDWARE_PRIMARY = /\b(?:satellite(?:\s*-?\s*based)?\s+internet|starlink|internet\s+mini\s+kits?|satellite\s+(?:antenna|dish)|mobile\s+satellite\s+internet|portable\s+satellite|satellite\s+terminal|leased\s+lines?|isp\b|broadband\s+(?:service|subscription|connectivity)|provision\s+of\s+internet\s+connectivity|internet\s+connectivity\s+services?)\b/i;
const EVENT_OR_CATERING = /\b(?:catering(?:\s+services?)?|consultation\s+workshop|national\s+consultation|workshop\s+on\b|meals?\s+and\s+snacks|packed\s+meals?|venue\s+rental|event\s+rental|function\s+halls?|food\s+packs?|grocer(?:y|ies)|menu\b)\b/i;
// Professional / consulting engagements must not become Software from PhilGEPS lot/UNSPSC wording alone.
const CONSULTING_OR_SERVICE_ENGAGEMENT = /\b(?:hiring\s+of\s+(?:an?\s+)?third[\s-]?party(?:\s+service\s+provider)?|engagement\s+of\s+(?:an?\s+)?third[\s-]?party(?:\s+service\s+provider)?|third[\s-]?party\s+service\s+provider|consultancy\s+services?|consulting\s+(?:services?|engagement)|market\s+research|research\s+services?|technical\s+consultancy|professional\s+services?|service[\s-]?provider\s+engagement|hiring\s+of\s+(?:an?\s+)?(?:consultants?|consultancy)|engagement\s+of\s+(?:an?\s+)?(?:consultants?|consultancy))\b/i;
// Direct software product / license / SaaS purchase cues (survives consulting conflict as Review when mixed).
const DIRECT_SOFTWARE_PURCHASE = /\b(?:software\s+(?:licen[cs]es?|subscription)|licen[cs]es?\s+of\s+software|statistical\s+software|helpdesk\s+software|it\s+helpdesk\s+software|(?:microsoft|office)\s*365|autodesk|civil\s*3d|stata|eviews?|saas|learning\s+management\s+system|\blms\b|cloud-?based\s+learning)\b/i;
const TITLE_STOP_WORDS = new Set([
  'supply', 'delivery', 'procurement', 'purchase', 'services', 'service', 'project',
  'various', 'other', 'with', 'from', 'that', 'this', 'and', 'for', 'the', 'lot',
  'one', 'use', 'used', 'through', 'additional', 'requirements', 'provision',
]);
const INCIDENTAL_SOFTWARE = [
  /\bquality management information system\b/gi,
  /\bno software required\b/gi,
  /\bsoftware assisted\b/gi,
  // Keep AV-production incidental wording; do NOT strip bare "editing software"
  // (that removed genuine "video editing software" procurement).
  /\bediting software\s*\/\s*tools\b/gi,
  /\banimation and editing software\b/gi,
  /\bsoftware\s*\/\s*tools\b/gi,
  /\bsoftware\s+and\s+equipment\b/gi,
  /\bon\s+(?:[a-z0-9]+\s+){1,4}software\b/gi,
  /\bsoftware\s+to\s+transfer\b/gi,
  /\bsoftware\s+(?:for\s+)?(?:image\s+)?transfer\b/gi,
  /\bsoftware\s+feature\s+sets?\b/gi,
  /\bnetwork\s+operating\s+systems?\b/gi,
  /\bsoftware\s*cds?\b/gi,
  /\bsetup\s+software\b/gi,
  /\bcalibration\s+software\b/gi,
  /\bsoftware\s+shall\s+provide\b/gi,
  /\b(?:bundled|included)\s+software\b/gi,
];
const SECURITY_PRODUCTS = [
  ['Web Application Firewall', /\bweb application firewalls?\b/i],
  ['WAF', /\bwafs?\b/i],
  ['web application security tool', /\bweb\s+application\s+security\s+tools?\b/i],
  ['web application security', /\bweb\s+application\s+security\b/i],
  ['application security tool', /\bapplication\s+security\s+tools?\b/i],
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
  ['board and lodging', /\bboard\s+and\s+lodging\b/i],
  ['electrical equipment', /\belectrical equipment\b/i],
  ['electrical supplies', /\belectrical supplies\b/i],
  ['electrical supplies', /\belectrical tape\b/i],
  ['signage', /\bsignage\b/i],
  ['printing or promotional materials', /\b(?:tarpaulins?|uniforms?|t-?shirts?|polo\s+shirts?|tokens?(?:\s+and\s+awards)?|plaques?|giveaways?|printing\s+and\s+delivery|reproduction\s+and\s+printing|printing\s+services|printing\s+of\b|printing\/production|yearbooks?|promotional\s+materials|iec\s+materials)\b/i],
  ['venue or event rental', /\b(?:venue\s+rental|event\s+rental|rental\s+of\s+(?:venue|function\s+hall)|lease\s+of\s+(?:venue|real\s+property))\b/i],
  ['transportation services', /\b(?:transportation\s+(?:services?|rental)|vehicle\s+rental|van\s+rental|bus\s+rental|provision\s+of\s+transportation|transport\s+services?)\b/i],
  ['training or event services', /\b(?:training\s+services?|training\s+materials|seminar(?:s|\s+workshops?)?|program\s+implementation\s+review)\b/i],
  ['architectural or engineering design services', /\b(?:architectural\s+design\s+services?|engineering\s+design\s+services?)\b/i],
  ['staff hiring or HR services', /\b(?:hiring\s+of\s+technical\s+staff|finance\s+analyst)\b/i],
  ['travel or tour services', /\b(?:tour\s+operator|travel\s+facilitation|media\s+familiarization)\b/i],
  ['groceries or dry goods', /\b(?:grocer(?:y|ies)|rice\b|raincoats?|eyeglasses?|plastic\s+drums?|school\s+ids?|gift\s+cert(?:ificate)?s?)\b/i],
];
const PHYSICAL_PROCUREMENT = [
  ['food or catering', /\b(?:catering(?:\s+services?)?|meals\s+and\s+snacks|food\s+packs|school[-\s]based\s+feeding|packed\s+meals?|provision\s+of\s+meals?|meals?\s+for\b|food\s+for\b|\bmenu\b|commercial\s+milk|\bmilk\b|dairy\s+products?|beverages?|various\s+meals)\b/i],
  ['workshop or consultation event', /\b(?:consultation\s+workshop|national\s+consultation\s+workshop|workshop\s+on\s+the\b)\b/i],
  ['construction or civil works', /\b(?:fencing|school\s+buildings|classrooms?|pavements?|asphalt|concreting|roofing|construction\s+of|embankment|access\s+road|water\s+pipeline|greening\s+of\s+building|structural\s+materials|drainage\s+canal|elevated\s+water\s+tank|solar\s+(?:water\s+)?pump|solar\s+pv\s+system)\b/i],
  ['building repair or renovation', /\b(?:labou?r\s+and\s+materials|(?:repair(?:\s*\/\s*|\s+and\s+)?(?:replacement|rehabilitation|maintenance|enhancement)?|rehabilitation|renovation|improvement)\s+of|corrective\s+maintenance|r\s+and\s+m\s+of)\b/i],
  ['agricultural supplies', /\b(?:\bseeds?\b|seedlings?|fertilizers?|agricultural\s+(?:and\s+marine\s+)?supplies|organic\s+fertilizer|forage|hybrid\s+rice|agri(?:cultural)?\s+supplies|fingerlings?|bangus|livestock|poultry|larvicides?|spinosad|plastic\s+sheets?)\b/i],
  ['agricultural machinery', /\b(?:tractors?|multicultivators?|forestry(?:\/|\s+)?hand[\s-]?held|hand[\s-]?held\s+equipment)\b/i],
  ['fuel or petroleum', /\b(?:diesel\s+fuels?|premium\s+gasoline|unleaded(?:\s+gasoline)?|fuel,?\s+diesel|(?:procurement|supply(?:\s+and\s+delivery)?)\s+of\s+(?:fuel|diesel|gasoline))\b/i],
  ['air conditioning equipment', /\b(?:air[- ]?conditioning\s+units?|airconditioning\s+units?|aircon\s+units?|\baircons?\b|air\s*coolers?)\b/i],
  ['safety or field supplies', /\b(?:safety\s+gears?|\bppe\b|survey\s+supplies|fire\s+extinguishers?|first[\s-]?aid\s+kits?|advocacy\s+kits?|travel\s+bags?|security\s+seals?|urban\s+search\s+and\s+rescue)\b/i],
  ['office or janitorial consumables', /\b(?:janitorial\s+supplies|bond\s+paper|trash\s+bags?|paper\s+products?|office\s+and\s+desk\s+accessories)\b/i],
  ['ink or toner consumables', /\b(?:epson\s+ink|\binks?\b|toners?|ink\s+cartridges?|toner\s+cartridges?|printer\s+ink)\b/i],
  ['packaging or warehouse materials', /\b(?:plastic\s+pallets?|\bpallets?\b|\bsacks?\b|\bcrates?\b)\b/i],
  ['medical or laboratory supplies', /\b(?:medical\s+supplies|medicines?|pharmaceuticals?|laboratory\s+supplies|dental\s+supplies|laboratory\s+reagents|laboratory\s+equipment|pipettors?|pipettes?|lidocaine|norepinephrine|contrast\s+media|\d+\s*mg(?:\/ml)?)\b/i],
  ['medical or imaging equipment', /\b(?:veterinary\s+ultrasound|ultrasound\s+(?:machine|equipment|unit|system)|medical\s+equipment|diagnostic\s+ultrasound)|\bultrasound\b/i],
  ['scientific or field instruments', /\b(?:multi-?parameter|wq\s+multiparameter|water\s+quality\s+(?:meter|sensor|probe|instrument)|light\s+meters?|measuring\s+and\s+observing)\b/i],
  ['vehicle or aircraft parts', /\b(?:\btires?\b|\btyres?\b|aircraft|helicopter|vehicle\s+parts?|automotive\s+parts?|spare\s+parts?|fitting\s+clevis|gasket\s+sealing|nut\s+self\s+locking|drain\s+tube|sleeve\s+compression|chamfered\s+washer)\b/i],
  ['network hardware', /\b(?:poe\+?\s*switch(?:es)?|network\s+switch(?:es)?|access\s+points?|wireless\s+access\s+points?|network\s+equipment|modems?)\b/i],
  ['power or storage hardware', /\b(?:\bups\b|uninterruptible\s+power(?:\s+supply)?|external\s+hard\s+drives?|storage\s+devices?|nas\s+storage|\bgensets?\b|compress(?:ed)?\s+air\s+system)\b/i],
  ['solar or physical power equipment', /\b(?:solar\s+(?:power|panels?|photovoltaic|kits?|equipment)|lithium\s+back-?up\s+batter(?:y|ies))\b/i],
  ['lighting or electrical fixtures', /\b(?:led\s+lamps?|lightbulbs?|lighting\s+fixtures?|lamps?\s+and\s+lightbulbs?|digital\s+signages?)\b/i],
  ['office machines', /\b(?:money\s+counters?|office\s+machines?|duplicating\s+machines?)\b/i],
  ['AV or broadcast hardware', /\b(?:video\s+switchers?|wireless\s+headset|intercom\s+set|livestreaming|audio\s+and\s+visual\s+presentation)\b/i],
  ['fire protection hardware', /\b(?:fire\s+detection|alarm\s+system|fire\s+protection)\b/i],
  ['ICT or physical hardware', /\b(?:ict\s+equipment|it\s+equipment|switch(?:es)?\s+and\s+cabling|personal\s+computers?|computer\s+sets?|photocopiers?|projectors?(?!\s+screens?\b)|smart\s+(?:tvs?|televisions?)|cctv|ip\s+cameras?|document\s+scanners?|high\s+speed\s+scanners?|\bscanners?\b|android\s+tablets?|tablet\s+(?:computers?|devices?)|tablets?\s+with\s+esim|digital\s+cameras?|peripherals?)\b/i],
  ['satellite or connectivity kits', /\b(?:satellite(?:\s*-?\s*based)?\s+internet|starlink|internet\s+mini\s+kits?|satellite\s+(?:antenna|dish|terminal)|mobile\s+satellite\s+internet)\b/i],
];
// PhilGEPS Business Category lines that are clearly non-software (used with structuredEvidenceText).
const NON_SOFTWARE_BUSINESS_CATEGORY = /\bBusiness Category:\s*(?:Aircraft|Dairy products(?:\s+and\s+eggs)?|Anaesthetic drugs(?:\s+and\s+related\s+adjuncts\s+and\s+analeptics)?|Sympathomimetic(?:\s+or\s+adrenergic\s+drugs)?|Agricultural and forestry(?:\s+and\s+landscape\s+machinery\s+and\s+equipment)?|Hotels and lodging(?:\s+and\s+meeting\s+facilities)?|Paper products|Concrete and cement(?:\s+and\s+plaster)?|Transport services|Prepared and preserved foods|Personal safety and protection|Lamps and lightbulbs(?:\s+and\s+lamp\s+components)?|Pipe piping(?:\s+and\s+pipe\s+fittings)?|Batteries and generators(?:\s+and\s+kinetic\s+power\s+transmission)?|Residential building construction(?:\s+services)?|Printed media|Pest control products|Fire protection|Seals|Lighting Fixtures(?:\s+and\s+Accessories)?|Office machines(?:\s+and\s+their\s+supplies\s+and\s+accessories)?|Laboratory and scientific equipment|Office and desk accessories|Audio and visual presentation(?:\s+and\s+composing\s+equipment)?|Communications Devices(?:\s+and\s+Accessories)?|Building and facility maintenance(?:\s+and\s+repair\s+services)?|Measuring and observing(?:\s+and\s+testing\s+instruments)?|Structural materials|Specialized educational services|Food and beverage industries|Photographic or filming(?:\s+or\s+video\s+equipment)?|Water resources development(?:\s+and\s+oversight)?|Advertising|Luggage and handbags(?:\s+and\s+packs\s+and\s+cases)?|Transportation components(?:\s+and\s+systems)?|Hardware|Educational institutions|Medical sterilization products|Construction and maintenance support equipment|Workplace safety equipment(?:\s+and\s+supplies\s+and\s+training\s+materials)?|Reproduction services|Human resources services|Chocolate and sugars(?:\s+and\s+sweeteners\s+and\s+confectionary\s+products)?|Hand tools|Consumer electronics|Specialized trade construction(?:\s+and\s+maintenance\s+services)?|Industrial pumps(?:\s+and\s+compressors)?|Radiopharmaceuticals(?:\s+and\s+contrast\s+media)?|Heavy construction services|Defense and law enforcement(?:\s+and\s+security\s+and\s+safety\s+training\s+equipment)?|Travel facilitation|Printing and publishing equipment|Permanent buildings(?:\s+and\s+structures)?|Institutional food services(?:\s+equipment)?|Bread and bakery products|Utilities|Rope and chain(?:\s+and\s+cable\s+and\s+wire\s+and\s+strap)?|General agreements(?:\s+and\s+contracts)?|Toys and games|Portable buildings(?:\s+and\s+structures)?)\b/i;
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

function hasSubscriptionTerm(softwareTerms) {
  return softwareTerms.some((term) => term.toLowerCase() === 'subscription');
}

function onlyWeakSoftwareTerms(softwareTerms) {
  return softwareTerms.length > 0
    && softwareTerms.every((term) => WEAK_SOFTWARE_TERMS.has(term.toLowerCase()));
}

function telecomSubscription(text, softwareTerms) {
  return hasSubscriptionTerm(softwareTerms)
    && onlyWeakSoftwareTerms(softwareTerms)
    && TELECOM_SERVICE.test(text);
}

function subscriptionWithSoftwareContext(text, softwareTerms) {
  return hasSubscriptionTerm(softwareTerms)
    && onlyWeakSoftwareTerms(softwareTerms)
    && SOFTWARE_SUBSCRIPTION_CONTEXT.test(text);
}

function licenseWithSoftwareContext(text) {
  return /\blicen[cs]es?\b/i.test(text)
    && LICENSE_SOFTWARE_OBJECT.test(text)
    && !HARDWARE_BUNDLE.test(text);
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

function nonSoftwareBusinessCategory(text) {
  return NON_SOFTWARE_BUSINESS_CATEGORY.test(String(text ?? ''))
    ? 'a non-software PhilGEPS business category'
    : '';
}

function hasDedicatedSoftwareProduct(text) {
  return DEDICATED_SOFTWARE_PRODUCT.test(String(text ?? ''));
}

function connectivityHardwarePrimary(text) {
  return CONNECTIVITY_HARDWARE_PRIMARY.test(String(text ?? ''));
}

function eventOrCateringContext(text) {
  return EVENT_OR_CATERING.test(String(text ?? ''));
}

function consultingOrServiceEngagement(text) {
  return CONSULTING_OR_SERVICE_ENGAGEMENT.test(String(text ?? ''));
}

function hasDirectSoftwarePurchaseCue(text) {
  const source = String(text ?? '');
  return DIRECT_SOFTWARE_PURCHASE.test(source)
    || (hasDedicatedSoftwareProduct(source) && /\b(?:licen[cs]es?|subscription|seats?)\b/i.test(source));
}

/** Bare "software" / incidental IT wording must not beat clear connectivity or event procurements. */
function connectivityOverridesSoftware(text, softwareTerms) {
  if (!connectivityHardwarePrimary(text)) return false;
  if (hasDedicatedSoftwareProduct(text)) return false;
  const strong = softwareTerms.filter((term) => !WEAK_SOFTWARE_TERMS.has(term.toLowerCase()));
  // Only bare/generic software cues (e.g. the word "software" in a secondary lot name).
  return strong.length === 0 || strong.every((term) => term.toLowerCase() === 'software');
}

function eventOverridesIncidentalDev(text, softwareTerms) {
  if (!eventOrCateringContext(text)) return false;
  if (hasDedicatedSoftwareProduct(text)) return false;
  // Real software subscriptions mentioned alongside meals stay mixed/review later.
  if (/\bsoftware\s+(?:subscription|licen[cs]e|licenses)\b/i.test(text)) return false;
  const strong = softwareTerms.filter((term) => !WEAK_SOFTWARE_TERMS.has(term.toLowerCase()));
  if (strong.length === 0) return false;
  // Workshop/catering titles often name a program "website and system development"
  // without procuring that software.
  return strong.every((term) => /^system development$/i.test(term));
}

/**
 * PhilGEPS lot/UNSPSC software wording must not override clear consulting / research /
 * professional-service procurement purpose. Mixed consulting + direct license/SaaS
 * wording is left for Review.
 */
function consultingOverridesGenericSoftware(text) {
  if (!consultingOrServiceEngagement(text)) return false;
  return !hasDirectSoftwarePurchaseCue(text);
}

function consultingMixedWithSoftwarePurchase(text) {
  return consultingOrServiceEngagement(text) && hasDirectSoftwarePurchaseCue(text);
}

function strongSoftwareTerms(text, rules) {
  return findTerms(text, rules.softwareTerms).filter((term) => !WEAK_SOFTWARE_TERMS.has(term.toLowerCase()));
}

function softwareResult(source, softwareTerms) {
  const reasons = [];
  for (const term of softwareTerms.slice(0, 4)) {
    const quote = excerpt(source, term);
    reasons.push(quote ? `The text includes "${term}" in: ${quote}` : `The text includes "${term}".`);
  }
  return {
    isRelevant: true,
    needsReview: false,
    confidence: softwareTerms.length >= 2 || !onlyWeakSoftwareTerms(softwareTerms) ? 0.9 : 0.75,
    category: 'software',
    reasons,
    notes: [softwareNote(source, softwareTerms)],
  };
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
  const fromDocument = classifyText(focused, rules);
  const fromTitle = noticeTitle ? classifyText(noticeTitle, rules) : null;
  if (
    fromTitle
    && isClearNotRelevant(fromTitle)
    && (fromDocument.isRelevant === true || fromDocument.needsReview === true)
  ) {
    return withNotes(fromTitle, [
      ...selected.notes,
      'Kept the title exclusion because the attachment did not show a different software purchase.',
    ]);
  }
  return withNotes(fromDocument, selected.notes);
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
  const source = stripIncidentalSoftwareMentions(text);
  const softwareTerms = findTerms(source, rules.softwareTerms);
  const hardwareTerms = findTerms(source, rules.hardwareTerms);
  const security = securityProduct(source);
  if (security) {
    return notRelevant(
      `The procurement is a security product (${security}), not a software product.`,
      [`Security product detected: ${security}`],
    );
  }
  if (telecomSubscription(source, softwareTerms)) {
    return notRelevant('The text describes a connectivity or telecom subscription, not a software product.');
  }

  if (connectivityOverridesSoftware(source, softwareTerms)) {
    return notRelevant(
      'The procurement describes satellite internet, connectivity, or network hardware, not a software product.',
      ['Connectivity or network hardware context overrides incidental software wording'],
    );
  }

  if (eventOverridesIncidentalDev(source, softwareTerms)) {
    return notRelevant(
      'The procurement describes a workshop, catering, or event service, not a software product.',
      ['Event or catering context overrides incidental system-development wording'],
    );
  }

  if (consultingOverridesGenericSoftware(source)) {
    return notRelevant(
      'The procurement describes a consulting, research, or professional-service engagement, not a software product purchase.',
      ['Consulting or service-provider context overrides incidental structured software wording'],
    );
  }

  if (consultingMixedWithSoftwarePurchase(source)) {
    return reviewResult(
      'The text mixes a consulting or service-provider engagement with software-product wording, so a person should check it.',
      ['Consulting engagement with dedicated software purchase wording'],
    );
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

  // PhilGEPS Business Category is strong non-software evidence when no dedicated product cues.
  const businessCategory = nonSoftwareBusinessCategory(source);
  if (businessCategory) {
    if (hasDedicatedSoftwareProduct(source) || hasDirectSoftwarePurchaseCue(source)) {
      return reviewResult(
        'The PhilGEPS business category looks non-software, but software-product wording is also present, so a person should check it.',
        [`PhilGEPS business category conflict: ${businessCategory}`],
      );
    }
    if (strong.length === 0 || strong.every((term) => term.toLowerCase() === 'software')) {
      return notRelevant(
        `The procurement falls under ${businessCategory}, not a software product purchase.`,
        [`PhilGEPS business category indicates non-software procurement`],
      );
    }
    return reviewResult(
      'The PhilGEPS business category looks non-software, but other software wording is also present, so a person should check it.',
      [`PhilGEPS business category conflict: ${businessCategory}`],
    );
  }

  if (hasDedicatedSoftwareProduct(source) && hardwareTerms.length === 0) {
    return softwareResult(source, softwareTerms.length > 0 ? softwareTerms : ['software']);
  }

  if (softwareTerms.length > 0 && strong.length === 0 && hardwareTerms.length === 0) {
    if (subscriptionWithSoftwareContext(source, softwareTerms)) {
      return softwareResult(source, softwareTerms);
    }
    if (hasSubscriptionTerm(softwareTerms)) {
      return reviewResult(
        'A subscription appears in the name, but there is not enough software context to classify it automatically.',
      );
    }
    return reviewResult('"information system" appears in the name, but the text does not show that software is the item being procured.');
  }

  // High-confidence license + software-object (not bare "license", not hardware bundles).
  if (
    softwareTerms.length === 0
    && hardwareTerms.length === 0
    && licenseWithSoftwareContext(source)
  ) {
    return softwareResult(source, ['license']);
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
    return softwareResult(source, softwareTerms);
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
