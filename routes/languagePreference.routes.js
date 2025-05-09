import { Router } from "express";
import { updateOrCreateLanguagePreference } from "../controllers/languageControllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router
  .route("/:userId")
  .put(updateOrCreateLanguagePreference);

export default router;