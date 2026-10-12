import express from 'express';
import { getSession, login, logout, startGuest } from '../controllers/auth-controller.js';
import { attachAuth, requireCsrf, requireRoles } from '../../auth/middleware.js';

const router = express.Router();

router.use(attachAuth);
router.get('/session', getSession);
router.post('/guest', startGuest);
router.post('/login', login);
router.post('/logout', requireRoles('guest', 'staff'), requireCsrf, logout);

export default router;
