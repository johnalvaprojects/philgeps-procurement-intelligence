import { MAX_BATCH_LIMIT } from '../backend/batch.js';
import { normalizeReference } from '../backend/parse.js';
import {
  awardSettings,
  batchStatus,
  buildOverview,
  checkSavedNotice,
  presentAward,
  savedNoticeSummaries,
  startBatch,
} from '../backend/service.js';
import { listAwards, readAward } from '../backend/store.js';
import { MERCHANT_CONNECTION } from '../backend/merchant-connection.js';
import {
  listMerchantAwards,
  merchantAwardsDirectory,
  merchantSummary,
  readMerchantAward,
  updateMerchantAward,
} from '../backend/merchant-store.js';

function fail(res, error) {
  if (error.code === 'INVALID') {
    res.status(400).json({ error: 'Invalid bid reference.' });
    return true;
  }
  if (error.code === 'NOT_FOUND') {
    res.status(404).json({ error: 'Notice not found' });
    return true;
  }
  if (error.code === 'BUSY') {
    res.status(409).json({ error: 'An award check is already running.' });
    return true;
  }
  return false;
}

const SCOPES = new Set(['software', 'review', 'all']);

export async function getAwardOverview(req, res, next) {
  try {
    const scope = String(req.query.scope || 'all');
    if (!SCOPES.has(scope)) {
      res.status(400).json({ error: 'Invalid notice scope.' });
      return;
    }
    if (scope === 'review' && req.auth.role !== 'staff') {
      res.status(403).json({ error: 'Staff sign-in required' });
      return;
    }
    const settings = awardSettings(req);
    const [notices, records] = await Promise.all([
      savedNoticeSummaries(settings.outputDir),
      listAwards(settings.awardsDir),
    ]);
    const visible = scope === 'all'
      ? notices
      : notices.filter((notice) => notice.classification === scope);
    res.json(buildOverview(visible, records, req.auth.role));
  } catch (error) {
    next(error);
  }
}

export async function getAward(req, res, next) {
  try {
    const reference = normalizeReference(req.params.reference);
    if (!reference) {
      res.status(400).json({ error: 'Invalid bid reference.' });
      return;
    }
    const settings = awardSettings(req);
    const notices = await savedNoticeSummaries(settings.outputDir);
    const notice = notices.find((item) => item.referenceNumber === reference);
    if (!notice) {
      res.status(404).json({ error: 'Notice not found' });
      return;
    }
    const stored = await readAward(settings.awardsDir, reference);
    const body = presentAward(stored || {
      referenceNumber: reference,
      outcome: 'never',
      awards: [],
      conflicts: [],
    }, req.auth.role);
    res.json({
      ...body,
      title: notice.title,
      organization: notice.organization,
      postedDate: notice.postedDate,
      deadline: notice.deadline,
    });
  } catch (error) {
    next(error);
  }
}

export async function checkAward(req, res, next) {
  try {
    const record = await checkSavedNotice(req.params.reference, awardSettings(req));
    res.json(presentAward(record, req.auth.role));
  } catch (error) {
    if (!fail(res, error)) next(error);
  }
}

export function getAwardBatch(req, res) {
  res.json(batchStatus(awardSettings(req).awardsDir));
}

export async function checkAwardBatch(req, res, next) {
  try {
    const raw = req.body?.limit;
    const limit = raw == null || raw === '' ? 8 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
      res.status(400).json({ error: `Choose 1 to ${MAX_BATCH_LIMIT} notices.` });
      return;
    }
    const scope = req.body?.scope == null || req.body?.scope === '' ? 'all' : String(req.body.scope);
    if (!['software', 'review', 'all'].includes(scope)) {
      res.status(400).json({ error: 'Invalid notice scope.' });
      return;
    }
    const started = await startBatch(awardSettings(req), limit, scope === 'all' ? null : scope);
    res.status(started.started ? 202 : 200).json(started.status);
  } catch (error) {
    if (!fail(res, error)) next(error);
  }
}

export async function getMerchantAwards(req, res, next) {
  try {
    const records = await listMerchantAwards(merchantAwardsDirectory(req.app.get('merchantAwardsDir')));
    res.json({
      records,
      summary: merchantSummary(records),
      connection: MERCHANT_CONNECTION,
      provenance: 'manual-verification',
      provenanceLabel: 'Manually verified — Not live synchronized.',
    });
  } catch (error) {
    next(error);
  }
}

export function getMerchantInvitations(_req, res) {
  res.json({
    records: [],
    connection: MERCHANT_CONNECTION,
    provenance: 'not-retrieved',
    provenanceLabel: 'PhilGEPS Merchant is not connected. Invitation records will appear here when an authorized retrieval method is available.',
  });
}

export async function getMerchantAward(req, res, next) {
  try {
    const record = await readMerchantAward(merchantAwardsDirectory(req.app.get('merchantAwardsDir')), req.params.awardNumber);
    if (!record) {
      res.status(404).json({ error: 'Award not found' });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
}

export async function putMerchantAward(req, res, next) {
  try {
    const record = await updateMerchantAward(
      merchantAwardsDirectory(req.app.get('merchantAwardsDir')),
      req.params.awardNumber,
      req.body,
    );
    res.json(record);
  } catch (error) {
    if (error.code === 'INVALID') {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
}
