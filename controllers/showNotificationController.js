import { ShowNotification } from "../models/showNotificationSchema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

// --- Your Existing Functions ---

/**
 * @description Create a new notification
 * @route POST /api/v1/notifications
 * @access Private (Requires authenticated user)
 */
const createNotification = asyncHandler(async (req, res) => {
    const { title, type, description, memberId, projectId } = req.body;

    // Basic validation
    if (!title || !type || !memberId) {
        throw new ApiError(400, "Title, type, and memberId are required.");
    }

    // ID Format validation
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
        throw new ApiError(400, "Invalid recipient (memberId) format.");
    }
    if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
        throw new ApiError(400, "Invalid project ID format.");
    }

    // Prepare data, ensuring optional fields are handled
    const notificationData = {
        title,
        type,
        description: description || "", // Default if empty
        memberId,
        ...(projectId && { projectId }), // Conditionally add projectId
    };

    const notification = await ShowNotification.create(notificationData);

    if (!notification) {
        // Should be rare if validation passes, but good practice
        throw new ApiError(500, "Failed to create notification in database.");
    }

    return res
        .status(201)
        .json(
            new ApiResponse(
                201,
                notification,
                "Notification created successfully"
            )
        );
});

/**
 * @description Get notifications (optionally filtered)
 * @route GET /api/v1/notifications
 * @access Private (Requires authenticated user - typically filtered for the user)
 */
const getNotifications = asyncHandler(async (req, res) => {
    // It's highly recommended to filter by the logged-in user by default
    // const requestingUserId = req.user?._id; // Assuming auth middleware adds req.user
    // if (!requestingUserId) {
    //     throw new ApiError(401, "User not authenticated");
    // }

    const { memberId, projectId, isRead } = req.query;
    const filter = {};

    // Apply filter for the requesting user unless an admin overrides (example)
    // filter.memberId = requestingUserId;

    // Allow filtering by specific memberId if provided (could be for admin use)
    if (memberId) {
        if (!mongoose.Types.ObjectId.isValid(memberId)) {
            throw new ApiError(400, "Invalid recipient (memberId) format in query.");
        }
        filter.memberId = memberId; // Override default user filter if needed
    }

    if (projectId) {
        if (!mongoose.Types.ObjectId.isValid(projectId)) {
            throw new ApiError(400, "Invalid project ID format in query.");
        }
        filter.projectId = projectId;
    }

    // Filter by read status if provided
    if (isRead !== undefined) {
        // Ensure isRead is treated as boolean
        filter.isRead = String(isRead).toLowerCase() === "true";
    }

    const notifications = await ShowNotification.find(filter)
        .sort({ createdAt: -1 }) // Sort by newest first
        .lean(); // Use .lean() for performance if you don't need Mongoose documents

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                notifications,
                "Notifications fetched successfully"
            )
        );
});

// --- New Functions ---

/**
 * @description Get a single notification by its ID
 * @route GET /api/v1/notifications/:id
 * @access Private (Requires authenticated user - ideally checks ownership)
 */
const getNotificationById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // const requestingUserId = req.user?._id; // Get logged-in user

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid notification ID format.");
    }

    const notification = await ShowNotification.findById(id).lean();

    if (!notification) {
        throw new ApiError(404, "Notification not found.");
    }

    // **Security Enhancement (Recommended):** Check if the user owns this notification
    // if (notification.memberId.toString() !== requestingUserId.toString()) {
    //    throw new ApiError(403, "You do not have permission to view this notification.");
    // }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                notification,
                "Notification fetched successfully"
            )
        );
});

/**
 * @description Update the read status of a notification
 * @route PATCH /api/v1/notifications/:id/status
 * @access Private (Requires authenticated user - ideally checks ownership)
 */
const updateNotificationStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isRead } = req.body; // Expecting { "isRead": true } or { "isRead": false }
    // const requestingUserId = req.user?._id; // Get logged-in user

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid notification ID format.");
    }

    // Validate isRead input
    if (typeof isRead !== "boolean") {
        throw new ApiError(
            400,
            "Invalid input: 'isRead' field must be true or false."
        );
    }

    // **Security Enhancement (Recommended):** Find the notification *and* check ownership first
    // const notificationToUpdate = await ShowNotification.findOne({ _id: id, memberId: requestingUserId });
    // if (!notificationToUpdate) {
    //     throw new ApiError(404, "Notification not found or you don't have permission to update it.");
    // }
    // Now update using the found ID, preventing updates on others' notifications

    // Find and update in one step (less secure if ownership isn't checked first)
    const updatedNotification = await ShowNotification.findByIdAndUpdate(
        id,
        { $set: { isRead: isRead } }, // Use $set to update only the specified field
        { new: true, runValidators: true } // Return the updated document and run schema validators
    );

    if (!updatedNotification) {
        // This will trigger if the ID doesn't exist (or if the security check above fails)
        throw new ApiError(404, "Notification not found.");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                updatedNotification,
                "Notification status updated successfully"
            )
        );
});

// --- Export all functions ---
export {
    createNotification,
    getNotifications,
    getNotificationById, // Add new function
    updateNotificationStatus, // Add new function
};