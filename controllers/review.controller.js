import { editProject as Project} from "../models/project.model.js";
import { Review } from "../models/reviewsModel.js";

export const createReview = async (req, res) => {
  const { projectId, userId, message, rating } = req.body;

  try {
    if (!message) {
      return res.status(400).json({ success: false, message: "Message required" });
    }

    // Check if project exists
    const project = await Project.findById(projectId).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    // Check if user is assigned (assuming projectOwners is an array)
    const isUserAssigned = project.projectOwners.some(ownerId => ownerId.toString() === userId);
    if (!isUserAssigned) {
      return res.status(403).json({ success: false, message: "User not assigned to this project" });
    }

    // Create the review
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


export const getAllReviews = async (req, res) => {
  const { projectId } = req.query;

  if (!projectId) {
    return res.status(400).json({ success: false, message: "Project ID is required" });
  }

  try {
    const reviews = await Review.find({ projectId })
      .populate('userId', 'name email') // Get user's name and email
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    console.error("Error fetching project reviews:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
