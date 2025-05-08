import { BusinessArea } from "../models/businessAreasModal.js";
import { User } from "../models/user.model.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";

// Helper function to get admin users (ID and token) for notifications
const getAdminUsersForNotifications = async () => {
  try {
    const adminUsers = await User.find({ isMain: true })
      .select("_id notificationToken fcmDeviceToken userName")
      .lean();

    return adminUsers.map(user => ({
      _id: user._id,
      userName: user.userName,
      notificationToken: user.notificationToken || user.fcmDeviceToken
    })).filter(user => user._id);
  } catch (error) {
    console.error("Error fetching admin users for notifications:", error);
    return [];
  }
};

// Helper function to send business area push notifications to all admins
const sendBusinessAreaPushNotifications = async (title, body, data) => {
  try {
    const adminRecipients = await getAdminUsersForNotifications();
    
    if (adminRecipients.length === 0) {
      console.warn("[Business Area Push] No admin users found or no tokens available.");
      return;
    }

    const fcmTokens = adminRecipients
      .map(r => r.notificationToken)
      .filter(Boolean);

    if (fcmTokens.length === 0) {
      console.warn("[Business Area Push] No valid FCM tokens found for admin users.");
      return;
    }

    console.log(`[Business Area Push] Sending notification to ${fcmTokens.length} admin devices`);
    await sendPushNotification(fcmTokens, title, body, data);
  } catch (error) {
    console.error("Error sending business area push notifications:", error);
  }
};

// Create or Update Business Area
export const createOrUpdateBusinessArea = async (req, res) => {
  const { businessArea, role } = req.body;
  const performingUser = req.user;
  const performingUserId = performingUser?._id;
  const performingUserName = performingUser?.userName || 'System';

  try {
    if (!businessArea) {
      return res.status(400).json({ success: false, message: "Business Area is required" });
    }

    const existing = await BusinessArea.findOne({ businessArea });
    let businessAreaData;
    let isNew = false;
    let actionVerb = "updated";

    if (existing) {
      if (role !== undefined) existing.role = role;
      await existing.save();
      businessAreaData = existing;
    } else {
      businessAreaData = await BusinessArea.create({
        businessArea,
        role
      });
      isNew = true;
      actionVerb = "created";
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      const notificationTitle = isNew ? `New Business Area Created` : `Business Area Updated`;
      const notificationDescription = `Business area "${businessAreaData.businessArea}" was ${actionVerb} by ${performingUserName}.`;
      
      // In-app notifications
      const inAppNotifications = adminRecipients.map(admin => ({
        title: notificationTitle,
        type: "Business Area Event",
        description: notificationDescription,
        memberId: admin._id,
        relatedId: businessAreaData._id,
        relatedModel: 'BusinessArea'
      }));
      
      if (inAppNotifications.length > 0) {
        await ShowNotification.create(inAppNotifications);
      }

      // Push notifications
      await sendBusinessAreaPushNotifications(
        notificationTitle,
        `"${businessAreaData.businessArea}" was ${actionVerb}.`,
        {
          type: isNew ? "BUSINESS_AREA_CREATED" : "BUSINESS_AREA_UPDATED",
          businessAreaId: businessAreaData._id.toString(),
          businessAreaName: businessAreaData.businessArea
        }
      );
    }

    res.status(isNew ? 201 : 200).json({
      success: true,
      message: `Business Area ${actionVerb} successfully`,
      data: businessAreaData,
    });
  } catch (error) {
    console.error("Error in createOrUpdateBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get All Business Areas
export const getAllBusinessAreas = async (req, res) => {
  try {
    const businessAreas = await BusinessArea.find({}, 'businessArea role createdAt').populate('role');
    res.status(200).json({ success: true, data: businessAreas });
  } catch (error) {
    console.error("Error in getAllBusinessAreas:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get Single Business Area by ID
export const getSingleBusinessArea = async (req, res) => {
  const { id } = req.params;

  try {
    const businessArea = await BusinessArea.findById(id, 'businessArea createdAt');
    if (!businessArea) {
      return res.status(404).json({ success: false, message: "Business Area not found" });
    }

    res.status(200).json({ success: true, data: businessArea });
  } catch (error) {
    console.error("Error in getSingleBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Update Business Area by ID
export const updateBusinessArea = async (req, res) => {
  const { id } = req.params;
  const { businessArea } = req.body;
  const performingUser = req.user;
  const performingUserId = performingUser?._id;
  const performingUserName = performingUser?.userName || 'System';

  try {
    if (!businessArea) {
      return res.status(400).json({ success: false, message: "Business Area is required" });
    }

    const updated = await BusinessArea.findByIdAndUpdate(
      id,
      { businessArea },
      { new: true, fields: 'businessArea createdAt' }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Business Area not found" });
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      const notificationTitle = "Business Area Updated";
      const notificationDescription = `Business area "${updated.businessArea}" was updated by ${performingUserName}.`;

      // In-app notifications
      const inAppNotifications = adminRecipients.map(admin => ({
        title: notificationTitle,
        type: "Business Area Event",
        description: notificationDescription,
        memberId: admin._id,
        relatedId: updated._id,
        relatedModel: 'BusinessArea'
      }));
      
      if (inAppNotifications.length > 0) {
        await ShowNotification.create(inAppNotifications);
      }

      // Push notifications
      await sendBusinessAreaPushNotifications(
        notificationTitle,
        `"${updated.businessArea}" was updated.`,
        {
          type: "BUSINESS_AREA_UPDATED",
          businessAreaId: updated._id.toString(),
          businessAreaName: updated.businessArea
        }
      );
    }

    res.status(200).json({
      success: true,
      message: "Business Area updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error in updateBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Delete Business Area by ID
export const deleteBusinessArea = async (req, res) => {
  const { id } = req.params;
  const performingUser = req.user;
  const performingUserName = performingUser?.userName || 'System';

  try {
    const deleted = await BusinessArea.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Business Area not found" });
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      const notificationTitle = "Business Area Deleted";
      const notificationDescription = `Business area "${deleted.businessArea}" was deleted by ${performingUserName}.`;

      // In-app notifications
      const inAppNotifications = adminRecipients.map(admin => ({
        title: notificationTitle,
        type: "Business Area Event",
        description: notificationDescription,
        memberId: admin._id,
        relatedModel: 'BusinessArea'
      }));
      
      if (inAppNotifications.length > 0) {
        await ShowNotification.create(inAppNotifications);
      }

      // Push notifications
      await sendBusinessAreaPushNotifications(
        notificationTitle,
        `Business area "${deleted.businessArea}" was deleted.`,
        {
          type: "BUSINESS_AREA_DELETED",
          businessAreaName: deleted.businessArea
        }
      );
    }

    res.status(200).json({ success: true, message: "Business Area deleted successfully" });
  } catch (error) {
    console.error("Error in deleteBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};