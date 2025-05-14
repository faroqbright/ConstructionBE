import { editProject } from "../models/project.model.js";
import { Review } from "../models/reviewsModel.js";
import mongoose from "mongoose";
import { User } from "../models/user.model.js"; // Example

export const createReview = async (req, res) => {
  const { projectId, userId, message, rating } = req.body;

  try {
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message required" });
    }

    const newReview = await Review.create({
      projectId,
      userId,
      message,
      rating,
    });

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
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

    if (
      projectId.length !== 24 ||
      !mongoose.Types.ObjectId.isValid(projectId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid Project ID format or length",
      });
    }

    const objectId = new mongoose.Types.ObjectId(projectId);

    const reviews = await Review.find(
      { projectId: objectId },
      "message rating createdAt userId projectId"
    )
      .populate("userId", "userName email") // Assuming review author also uses userName
      .sort({ createdAt: -1 })
      .lean();

    if (reviews.length === 0) {
      // console.log(`[DEBUG] No reviews found for projectId: ${projectId}`); // Optional
      return res.status(200).json({
        success: true,
        message: "No reviews found for this project",
        data: [],
      });
    }

    const project = await editProject
      .findById(objectId)
      .populate({
        path: "projectOwners.ownerId",
        select: "userName email _id", // <--- USE 'userName' HERE
      })
      .select("projectOwners projectName projectBanner")
      .lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const projectOwnersFromDB = project.projectOwners || [];

    const reviewsWithProjectData = reviews.map((review) => ({
      ...review,
      project: {
        projectOwners: projectOwnersFromDB.map((ownerSubDoc) => {
          // console.log("[DEBUG] Processing ownerSubDoc from project.projectOwners:", JSON.stringify(ownerSubDoc, null, 2)); // Optional
          let resolvedOwnerName = ownerSubDoc.ownerName; // Default to stored string
          let populatedOwnerIdFields = null;

          if (ownerSubDoc.ownerId && typeof ownerSubDoc.ownerId === "object") {
            populatedOwnerIdFields = ownerSubDoc.ownerId;

            if (populatedOwnerIdFields.userName) {
              resolvedOwnerName = populatedOwnerIdFields.userName;
            } else {
              // console.log("[DEBUG] Could not find 'userName' in populated ownerId. Using stored ownerName:", resolvedOwnerName); // Optional
            }
          } else {
            // console.log("[DEBUG] ownerSubDoc.ownerId was not populated or is not an object. Original ownerId value:", ownerSubDoc.ownerId, ". Using stored ownerName:", resolvedOwnerName); // Optional
          }

          return {
            _id: ownerSubDoc._id,
            ownerId: populatedOwnerIdFields
              ? populatedOwnerIdFields._id
              : ownerSubDoc.ownerId || null,
            ownerName: resolvedOwnerName,
          };
        }),
        projectName: project.projectName,
        projectBanner: project.projectBanner,
      },
    }));

    res.status(200).json({
      success: true,
      data: reviewsWithProjectData,
    });
  } catch (error) {
    console.error("ERROR in getReviewByProjectId:", error.message);
    console.error("Full error stack:", error.stack); // Keep for detailed debugging
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              stack: error.stack,
            }
          : undefined,
    });
  }
};

export const getAllReviews = async (req, res) => {
  try {
    console.log("1. Starting to fetch all reviews...");
    const reviews = await Review.find(
      {},
      "name email message rating createdAt projectId userId"
    ).sort({ createdAt: -1 });
    console.log("2. Reviews fetched successfully. Count:", reviews.length);
    console.log(
      "Sample review:",
      reviews[0] ? reviews[0].toObject() : "No reviews found"
    );

    const projectIds = [
      ...new Set(reviews.map((review) => review.projectId?.toString())),
    ].filter(Boolean);
    console.log("3. Unique project IDs extracted:", projectIds);

    if (projectIds.length === 0) {
      console.log("3a. No project IDs found in reviews");
      return res.status(200).json({
        success: true,
        data: [],
        message: "No reviews with valid project IDs found",
      });
    }

    console.log("4. Starting to fetch projects...");
    const projects = await editProject
      .find(
        { _id: { $in: projectIds } },
        "projectOwners projectName projectBanner"
      )
      .lean();
    console.log("5. Projects fetched successfully. Count:", projects.length);
    console.log("Sample project:", projects[0] || "No projects found");

    const projectMap = {};
    projects.forEach((project) => {
      projectMap[project._id.toString()] = {
        projectOwners: project.projectOwners,
        projectName: project.projectName,
        projectBanner: project.projectBanner,
      };
    });
    console.log("6. Project map created with keys:", Object.keys(projectMap));

    const userIds = [
      ...new Set(reviews.map((review) => review.userId?.toString())),
    ].filter(Boolean);
    console.log("7. Unique user IDs extracted:", userIds);

    console.log("8. Starting to combine review data with project data...");
    // const reviewsWithProjectData = reviews.map((review) => {
    //   const projectData = projectMap[review.projectId?.toString()] || null;
    //   console.log(
    //     `8a. Processing review ${review._id} - project data:`,
    //     projectData ? "found" : "not found"
    //   );

    //   return {
    //     ...review.toObject(),
    //     project: projectData,
    //   };
    // });
    const reviewsWithProjectData = reviews
      .filter((review) => projectMap[review.projectId?.toString()])
      .map((review) => {
        const projectData = projectMap[review.projectId.toString()];
        return {
          ...review.toObject(),
          project: projectData,
        };
      });

    console.log("9. Final data processing complete");

    res.status(200).json({
      success: true,
      data: reviewsWithProjectData,
    });
    console.log("10. Response sent successfully");
  } catch (error) {
    console.error("ERROR in getAllReviews:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const deleteProjectWithReviews = async (req, res) => {
  const { projectId } = req.params;

  try {
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

    // Step 1: Delete reviews related to the project
    const deletedReviews = await Review.deleteMany({ projectId });

    // Step 2: Delete the project
    const deletedProject = await editProject.findByIdAndDelete(projectId);

    if (!deletedProject) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    res.status(200).json({
      success: true,
      message: `Project associated review(s) deleted successfully`,
    });
  } catch (error) {
    console.error("Error in deleteProjectWithReviews:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
