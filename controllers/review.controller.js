import { editProject } from "../models/project.model.js";
import { Review } from "../models/reviewsModel.js";
import mongoose from "mongoose";
import { User } from "../models/user.model.js"; 

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
      "message rating createdAt userId projectId" // Removed name, email as they should come from User populate
    )
      .populate("userId", "userName email") // Populate review author's userName and email
      .sort({ createdAt: -1 })
      .lean(); // Use lean for reviews as well for consistency and performance

    console.log("2. Reviews fetched successfully. Count:", reviews.length);
    if (reviews.length > 0) {
      console.log("Sample review (after populate):", reviews[0]);
    } else {
      console.log("No reviews found in the database.");
      return res.status(200).json({
        success: true,
        data: [],
        message: "No reviews found",
      });
    }

    const projectIds = [
      ...new Set(reviews.map((review) => review.projectId?.toString())),
    ].filter(Boolean); // Filter out any null/undefined projectIds
    console.log("3. Unique project IDs extracted:", projectIds);

    if (projectIds.length === 0) {
      console.log(
        "3a. No valid project IDs found in reviews, returning reviews as is (or an empty project array per review)."
      );
      // If no project IDs, reviews will have null for project.
      // Or, you might decide to not return reviews that don't have a projectId.
      // For now, let's map and add an empty project object if no project is found.
      const reviewsWithoutProjectDetails = reviews.map((review) => ({
        ...review,
        project: null, // Or some default project structure
      }));
      return res.status(200).json({
        success: true,
        data: reviewsWithoutProjectDetails,
        message:
          "Reviews fetched, but no associated project details found for some/all.",
      });
    }

    console.log("4. Starting to fetch projects with populated owners...");
    const projects = await editProject
      .find({ _id: { $in: projectIds } })
      .populate({
        path: "projectOwners.ownerId", // Path to the array and the ref field
        select: "userName email _id", // Select userName, email, and _id from User model
      })
      .select("projectOwners projectName projectBanner") // Select fields from editProject
      .lean(); // Use lean here

    console.log("5. Projects fetched successfully. Count:", projects.length);
    if (projects.length > 0) {
      console.log("Sample project (after populate):", projects[0]);
      if (projects[0].projectOwners && projects[0].projectOwners.length > 0) {
        console.log(
          "Sample project owner (after populate):",
          projects[0].projectOwners[0]
        );
      }
    }

    const projectMap = {};
    projects.forEach((project) => {
      // Process projectOwners to include resolvedOwnerName
      const processedProjectOwners = (project.projectOwners || []).map(
        (ownerSubDoc) => {
          let resolvedOwnerName = ownerSubDoc.ownerName; // Fallback
          let populatedOwnerIdFields = null;

          if (ownerSubDoc.ownerId && typeof ownerSubDoc.ownerId === "object") {
            populatedOwnerIdFields = ownerSubDoc.ownerId;
            if (populatedOwnerIdFields.userName) {
              resolvedOwnerName = populatedOwnerIdFields.userName;
            }
          }
          return {
            _id: ownerSubDoc._id,
            ownerId: populatedOwnerIdFields
              ? populatedOwnerIdFields._id
              : ownerSubDoc.ownerId || null,
            ownerName: resolvedOwnerName,
          };
        }
      );

      projectMap[project._id.toString()] = {
        // Use the processed owners
        projectOwners: processedProjectOwners,
        projectName: project.projectName,
        projectBanner: project.projectBanner,
      };
    });
    console.log("6. Project map created with keys:", Object.keys(projectMap));

    console.log("8. Starting to combine review data with project data...");
    const reviewsWithProjectData = reviews.map((review) => {
      const projectData = review.projectId
        ? projectMap[review.projectId.toString()]
        : null;
      // console.log( // Optional: more detailed logging per review
      //   `8a. Processing review ${review._id} - project data:`,
      //   projectData ? "found" : "not found"
      // );

      return {
        ...review, // review is already a lean object
        project: projectData, // projectData now includes the resolved ownerName
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
