import NotificationStatus from "../models/notificationStatus.model.js";

// Create a single notification
export const createNotification = async (req, res) => {
  try {
    const { title, description, status } = req.body;

    if (!title || typeof status !== "boolean") {
      return res
        .status(400)
        .json({ message: "Title and status are required." });
    }

    const newNotification = new NotificationStatus({
      title,
      description,
      status,
    });
    const savedNotification = await newNotification.save();

    res.status(201).json({
      message: "Notification created successfully",
      data: savedNotification,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "An error occurred while creating the notification." });
  }
};

// Get a single notification by ID
export const getNotificationById = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await NotificationStatus.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found." });
    }

    res.status(200).json({
      message: "Notification fetched successfully",
      data: notification,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching the notification." });
  }
};

// Update a notification by ID
export const updateNotificationById = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { title, description, status } = req.body;

    const updatedNotification = await NotificationStatus.findByIdAndUpdate(
      notificationId,
      { title, description, status },
      { new: true }
    );

    if (!updatedNotification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found." });
    }

    res.status(200).json({
      success: true, // ✅ Add this line
      message: "Notification updated successfully",
      data: updatedNotification,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false, // ✅ Add this too
      message: "An error occurred while updating the notification.",
    });
  }
};

// Get all notifications
export const getAllNotifications = async (req, res) => {
  try {
    const notifications = await NotificationStatus.find().sort({
      createdAt: -1,
    });

    res.status(200).json({
      message: "All notifications fetched successfully",
      data: notifications,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching all notifications." });
  }
};

// Delete a notification by ID
export const deleteNotificationById = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const deletedNotification =
      await NotificationStatus.findByIdAndDelete(notificationId);
    if (!deletedNotification) {
      return res.status(404).json({ message: "Notification not found." });
    }

    res.status(200).json({
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the notification." });
  }
};
