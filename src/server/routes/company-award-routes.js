import express from 'express';
import { attachAuth, requireCsrf, requireRoles } from '../../auth/middleware.js';
import {
  deleteCompanyAward,
  getCompanyAward,
  listCompanyAwards,
  putCompanyAward,
} from '../controllers/company-award-controller.js';

const router = express.Router();
const staff = requireRoles('staff');

router.use(attachAuth);
router.get('/', staff, listCompanyAwards);
router.get('/:noticeId', staff, getCompanyAward);
router.put('/:noticeId', staff, requireCsrf, putCompanyAward);
router.delete('/:noticeId', staff, requireCsrf, deleteCompanyAward);

export default router;
