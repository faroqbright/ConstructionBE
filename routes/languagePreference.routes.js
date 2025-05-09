import { Router } from "express";
import { getLanguagePreferenceByUserId, updateOrCreateLanguagePreference } from "../controllers/languageControllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router
  .route("/:userId")
  .put(updateOrCreateLanguagePreference)
  .get(getLanguagePreferenceByUserId)

export default router;