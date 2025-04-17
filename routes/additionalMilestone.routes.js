import express from "express";
import {
  createOrUpdateMilestone,
  getAllMilestones,
  getSingleMilestone,
  updateMilestone,
  deleteMilestone,
  getUserMilestones
} from "../controllers/additionalMilestoneController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.route("/milestone/:id").post(verifyJWT, createOrUpdateMilestone);

router.route("/milestone/:id").get(verifyJWT, getAllMilestones);

router.route("/milestone/single/:id").get(verifyJWT, getSingleMilestone);

router.route("/milestone/update/:id").put(verifyJWT, updateMilestone);

router.route("/milestone/delete/:id").delete(verifyJWT, deleteMilestone);
router.get("/user/:id", getUserMilestones);

export default router;