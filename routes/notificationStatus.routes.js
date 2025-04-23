import express from 'express';
import { createNotificationStatuses, getNotificationById, updateNotificationStatusById, getAllNotificationStatuses } from '../controllers/notificationStatus.contoller.js';

const router = express.Router();

// Create multiple notification statuses (exactly 4)
router.post('/', createNotificationStatuses);
router.get('/notifications/:notificationId', getNotificationById);
router.put('/:notificationId', updateNotificationStatusById);
router.get('/allNotificationStatus', getAllNotificationStatuses);

export default router;
