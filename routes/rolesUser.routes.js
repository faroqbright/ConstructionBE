import express from "express";
import { createroleUser, getAllroleUsers, getroleUserById,  deleteroleUserById, editRoleUser } from "../controllers/roleUsers.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

// Routes for roleUser
router.route('/')
    .post(verifyJWT, createroleUser)
    .get(verifyJWT, getAllroleUsers);

router.route('/:id')
    .get(verifyJWT, getroleUserById)
    .patch(verifyJWT, editRoleUser)
    .delete(verifyJWT, deleteroleUserById);

export default router;
