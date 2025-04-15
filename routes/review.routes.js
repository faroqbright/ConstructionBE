import express from "express";
import { createReview, getAllReviews } from "../controllers/review.controller.js";
const router = express.Router();

// POST /api/reviews - create a new review
router.post("/", createReview);

// GET /api/reviews - fetch all reviews
router.get("/", getAllReviews);

export default router;
