import express from 'express';
import { attachAuth, requireCsrf, requireRoles } from '../../../src/auth/middleware.js';
import {
  checkAward,
  checkAwardBatch,
  getAward,
  getAwardBatch,
  getAwardOverview,
  getMerchantInvitations,
  getMerchantAward,
  getMerchantAwards,
} from './award-controller.js';

const router = express.Router();
const staff = requireRoles('staff');
const reader = requireRoles('guest', 'staff');

router.use(attachAuth);
router.get('/', reader, getAwardOverview);
router.get('/batch', staff, getAwardBatch);
router.post('/batch', staff, requireCsrf, checkAwardBatch);
function merchantWritesDisabled(_req, res) {
  res.status(403).json({ error: 'Merchant award updates are disabled.' });
}

router.get('/invitations', staff, getMerchantInvitations);
router.get('/merchant', staff, getMerchantAwards);
router.get('/merchant/:awardNumber', staff, getMerchantAward);
router.post('/merchant/:awardNumber', staff, requireCsrf, merchantWritesDisabled);
router.get('/:reference', reader, getAward);
router.post('/:reference/check', staff, requireCsrf, checkAward);

export default router;
