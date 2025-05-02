
import { asyncHandler } from "../utils/asyncHandler.js";
import { Notification } from "../models/notifications.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const createNotification = asyncHandler(async (req, res) => {
  try {
    const { title, description, type, clientIds = [], userIds = [] } = req.body;

    // Validate required fields
    if (!title || !description || !type) {
      throw new ApiError(400, 'Title, description, and type are required');
    }

    // Create and save the notification
    const notification = new Notification({
      title,
      description,
      type,
      clientIds,
      userIds,
    });

    const savedNotification = await notification.save();

    // Populate references before sending response
    const populatedNotification = await Notification.findById(savedNotification._id)
      .populate('userIds', 'userName email avatar')
      .populate('clientIds', 'name email companyName');

    res.status(201).json(
      new ApiResponse(201, populatedNotification, 'Notification created successfully')
    );
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});



const getNotifications = asyncHandler(async (req, res) => {
  try {
    const notifications = await Notification.find()
      .populate('userIds', 'userName email avatar')   // Populate user fields
      .populate('clientIds', 'name email companyName') // Adjust fields based on your Client model
      .sort({ createdAt: -1 });

    res
      .status(200)
      .json(new ApiResponse(200, notifications, 'Notifications retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});


  export {createNotification,getNotifications};
