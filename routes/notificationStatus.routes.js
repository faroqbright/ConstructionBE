import express from 'express';
import { createNotificationStatuses, updateNotificationStatusById } from '../controllers/notificationStatus.contoller.js';

const router = express.Router();

// Create multiple notification statuses (exactly 4)
router.post('/', createNotificationStatuses);
router.put('/:notificationId', updateNotificationStatusById);

export default router;
