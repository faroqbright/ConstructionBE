
import { Router } from 'express';
import { createNotification,getNotifications } from '../controllers/notifications.controller.js';
import { errorHandler } from "../utils/errorHandler.js";

const router = Router();


router.route('/create-notifications').post(createNotification);
router.route('/get-notifications').get(getNotifications);



router.use(errorHandler);


export default router;