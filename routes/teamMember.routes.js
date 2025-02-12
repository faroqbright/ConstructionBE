import express from "express";
import { createteamMember, getAllteamMembers, getteamMemberById, updateteamMemberById, deleteteamMemberById } from "../controllers/teamMember.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

// Routes for teamMember
router.route('/')
    .post(verifyJWT,upload.fields([
        {
          name: "avatar",
          maxCount: 1,
        }
      ]), createteamMember)
    .get(verifyJWT, getAllteamMembers);

router.route('/:id')
    .get(verifyJWT, getteamMemberById)
    .put(verifyJWT,upload.fields([  
        {
          name: "avatar",
          maxCount: 1,
        }
      ]), updateteamMemberById)
    .delete(verifyJWT, deleteteamMemberById);

export default router;
