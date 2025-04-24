import express from 'express';
import {
  createNotification,
  getNotificationById,
  updateNotificationById,
  getAllNotifications,
  deleteNotificationById
} from '../controllers/notificationStatus.contoller.js';

const router = express.Router();

router.post('/create-notificationStatus', createNotification);
router.get('/get-notificationStatus', getAllNotifications);
router.get('/:notificationId', getNotificationById);
router.put('/:notificationId', updateNotificationById);
router.delete('/:notificationId', deleteNotificationById);

export default router;
