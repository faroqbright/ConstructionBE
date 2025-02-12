import { asyncHandler } from "../utils/asyncHandler.js";
import { Notification } from "../models/notifications.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";




const createNotification = asyncHandler(async (req, res) => {
    try {
      const { title, description } = req.body;
      const notification = new Notification({ title, description });
      await notification.save();
      res.status(201).json(new ApiResponse(201, notification, 'Notification created successfully'));
    } catch (error) {
      throw new ApiError(400, error.message);
    }
  });

  const getNotifications = asyncHandler(async (req, res) => {
    try {
      const notifications = await Notification.find()
        .sort({ createdAt: -1 })
 
      res.json(new ApiResponse(200, notifications, 'Notifications retrieved successfully'));
    } catch (error) {
      throw new ApiError(500, error.message);
    }
  });

  export {createNotification,getNotifications};