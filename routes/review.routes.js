import express from "express";
import { createReview, getAllReviews, getReviewByProjectId, deleteProjectWithReviews  } from "../controllers/review.controller.js";
const router = express.Router();

// POST /api/reviews - create a new review
router.post("/", createReview);

router.get('/:projectId', getReviewByProjectId);

// GET /api/reviews - fetch all reviews
router.get("/", getAllReviews);

router.delete("/projects/:projectId", deleteProjectWithReviews);

export default router;
