import express from "express";
import { createReview, getAllReviews } from "../controllers/review.controller.js";
const router = express.Router();

// POST /api/reviews - create a new review
router.post("/create_review", createReview);

// GET /api/reviews - fetch all reviews
router.get("/get_review", getAllReviews);

export default router;
