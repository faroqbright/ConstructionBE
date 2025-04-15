import { Review } from "../models/reviewsModel.js";

export const createReview = async (req, res) => {
  const { projectId, userId, message, rating } = req.body;

  try {
    if (!message) {
      return res.status(400).json({ success: false, message: "Message required" });
    }

    const newReview = await Review.create({ projectId, userId, message, rating });

    res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: newReview,
    });
  } catch (error) {
    console.error("Error in createReview:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get All Reviews
export const getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find({}, 'name email message rating createdAt').sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    console.error("Error in getAllReviews:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
