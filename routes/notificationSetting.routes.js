import { Router } from "express";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../controllers/notificationSetting.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// All routes in this file will require authentication
router.use(verifyJWT);

router
  .route("/:userId")
  .get(getNotificationSettings)
  .put(updateNotificationSettings);

export default router;