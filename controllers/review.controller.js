import { editProject } from "../models/project.model.js";
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

export const getReviewByProjectId = async (req, res) => {
  const { projectId } = req.params;

  try {
    if (!projectId) {
      return res.status(400).json({ success: false, message: "Project ID is required" });
    }

    console.log(`Fetching reviews for projectId: ${projectId}`);

    const reviews = await Review.find({ projectId }, 'message rating createdAt userId')
      .sort({ createdAt: -1 })
      .lean();

    if (reviews.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No reviews found for this project",
        data: []
      });
    }

    res.status(200).json({
      success: true,
      data: reviews
    });

  } catch (error) {
    console.error("ERROR in getReviewByProjectId:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : undefined
    });
  }
};


export const getAllReviews = async (req, res) => {
  try {
    console.log('1. Starting to fetch all reviews...');
    const reviews = await Review.find({}, 'name email message rating createdAt projectId userId').sort({ createdAt: -1 });
    console.log('2. Reviews fetched successfully. Count:', reviews.length);
    console.log('Sample review:', reviews[0] ? reviews[0].toObject() : 'No reviews found');

    const projectIds = [...new Set(reviews.map(review => review.projectId?.toString()))].filter(Boolean);
    console.log('3. Unique project IDs extracted:', projectIds);
    
    if (projectIds.length === 0) {
      console.log('3a. No project IDs found in reviews');
      return res.status(200).json({
        success: true,
        data: [],
        message: "No reviews with valid project IDs found"
      });
    }

    console.log('4. Starting to fetch projects...');
    const projects = await editProject.find(
      { _id: { $in: projectIds } },
      'projectOwners projectName projectBanner'
    ).lean();
    console.log('5. Projects fetched successfully. Count:', projects.length);
    console.log('Sample project:', projects[0] || 'No projects found');

    const projectMap = {};
    projects.forEach(project => {
      projectMap[project._id.toString()] = {
        projectOwners: project.projectOwners,
        projectName: project.projectName,
        projectBanner: project.projectBanner
      };
    });
    console.log('6. Project map created with keys:', Object.keys(projectMap));

    const userIds = [...new Set(reviews.map(review => review.userId?.toString()))].filter(Boolean);
    console.log('7. Unique user IDs extracted:', userIds);

    console.log('8. Starting to combine review data with project data...');
    const reviewsWithProjectData = reviews.map(review => {
      const projectData = projectMap[review.projectId?.toString()] || null;
      console.log(`8a. Processing review ${review._id} - project data:`, projectData ? 'found' : 'not found');
      
      return {
        ...review.toObject(),
        project: projectData
      };
    });
    console.log('9. Final data processing complete');

    res.status(200).json({
      success: true,
      data: reviewsWithProjectData,
    });
    console.log('10. Response sent successfully');
  } catch (error) {
    console.error("ERROR in getAllReviews:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};