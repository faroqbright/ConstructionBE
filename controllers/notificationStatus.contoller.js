import NotificationStatus from '../models/notificationStatus.model.js';

// Create new notification statuses
export const createNotificationStatuses = async (req, res) => {
  try {
    // Destructure the incoming data from the request body
    const { notifications } = req.body; // Expecting an array of notification objects

    // Validate that the notifications array has the required fields
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return res.status(400).json({ message: 'Notifications array is required and cannot be empty.' });
    }

    // Create a new NotificationStatus document with the array of notifications
    const newNotificationStatus = new NotificationStatus({
      notifications,
    });

    // Save the new notification statuses to the database
    const savedNotificationStatus = await newNotificationStatus.save();

    // Return success response
    res.status(201).json({
      message: 'Notification statuses created successfully',
      data: savedNotificationStatus,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'An error occurred while creating notification statuses' });
  }
};

export const updateNotificationStatusById = async (req, res) => {
    try {
      const { notificationId } = req.params; // This is the _id of the embedded notification
      const { status } = req.body;
  
      // Update the status of the notification with the given ID
      const updatedDocument = await NotificationStatus.findOneAndUpdate(
        { 'notifications._id': notificationId },
        { $set: { 'notifications.$.status': status } },
        { new: true }
      );
  
      if (!updatedDocument) {
        return res.status(404).json({ message: 'Notification not found.' });
      }
  
      res.status(200).json({
        message: 'Notification status updated successfully',
        data: updatedDocument,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'An error occurred while updating notification status.' });
    }
  };
