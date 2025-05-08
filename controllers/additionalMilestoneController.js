import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { User } from "../models/user.model.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";

const getProjectNotificationRecipients = async (
  projectId,
  performingUserId
) => {
  console.log(`[Notification] Getting recipients for project ${projectId}`);

  const project = await editProject
    .findById(projectId)
    .populate("members", "_id notificationToken fcmDeviceToken")
    .populate("projectOwners.ownerId", "_id notificationToken fcmDeviceToken");

  if (!project) {
    console.error("[Notification] Project not found");
    return { recipients: [], recipientIds: new Set() };
  }

  const recipientUserObjects = [];
  const recipientUserObjectIds = new Set();

  // Process members
  console.log(
    `[Notification] Project has ${project.members?.length || 0} members`
  );
  project.members?.forEach((member) => {
    if (member?._id) {
      const token = member.notificationToken || member.fcmDeviceToken;
      console.log(
        `[Notification] Adding member ${member._id} with token: ${token ? "exists" : "missing"}`
      );
      recipientUserObjects.push({
        ...member.toObject(),
        effectiveToken: token,
      });
      recipientUserObjectIds.add(member._id.toString());
    }
  });

  // Process owners
  console.log(
    `[Notification] Project has ${project.projectOwners?.length || 0} owners`
  );
  project.projectOwners?.forEach((ownerObj) => {
    if (ownerObj?.ownerId?._id) {
      const token =
        ownerObj.ownerId.notificationToken || ownerObj.ownerId.fcmDeviceToken;
      console.log(
        `[Notification] Adding owner ${ownerObj.ownerId._id} with token: ${token ? "exists" : "missing"}`
      );
      recipientUserObjects.push({
        ...ownerObj.ownerId.toObject(),
        effectiveToken: token,
      });
      recipientUserObjectIds.add(ownerObj.ownerId._id.toString());
    }
  });

  // Add performing user if not already included
  if (
    performingUserId &&
    !recipientUserObjectIds.has(performingUserId.toString())
  ) {
    console.log(`[Notification] Adding performing user ${performingUserId}`);
    const performer = await User.findById(performingUserId)
      .select("_id notificationToken fcmDeviceToken")
      .lean();
    if (performer) {
      const token = performer.notificationToken || performer.fcmDeviceToken;
      console.log(
        `[Notification] Performing user token: ${token ? "exists" : "missing"}`
      );
      recipientUserObjects.push({
        ...performer,
        effectiveToken: token,
      });
      recipientUserObjectIds.add(performer._id.toString());
    }
  }

  console.log(
    `[Notification] Total recipients: ${recipientUserObjectIds.size}`
  );
  return {
    recipients: recipientUserObjects,
    recipientIds: recipientUserObjectIds,
    project,
  };
};

// Enhanced version of sendMilestonePushNotifications
const sendMilestonePushNotifications = async (
  recipients,
  title,
  body,
  data
) => {
  try {
    console.log(
      `[Push Notification] Preparing to send to ${recipients.length} users`
    );

    // Filter recipients with valid tokens
    const validRecipients = recipients.filter(
      (user) => (user.notificationToken || user.fcmDeviceToken) && user._id
    );

    // Get unique tokens (some users might have same token on multiple devices)
    const fcmTokens = [
      ...new Set(
        validRecipients
          .map((user) => user.notificationToken || user.fcmDeviceToken)
          .filter(Boolean)
      ),
    ];

    if (fcmTokens.length === 0) {
      console.warn(
        "[Push Notification] No valid FCM tokens found for recipients"
      );
      console.log(
        "Recipients checked:",
        recipients.map((r) => ({
          id: r._id,
          hasToken: !!(r.notificationToken || r.fcmDeviceToken),
        }))
      );
      return;
    }

    console.log(`[Push Notification] Sending to ${fcmTokens.length} devices`);
    console.log("Notification details:", { title, body, data });

    const result = await sendPushNotification(fcmTokens, title, body, data);
    console.log("[Push Notification] Send result:", result);
    return result;
  } catch (error) {
    console.error("[Push Notification] Error:", error);
    throw error;
  }
};

// export const createOrUpdateMilestone = async (req, res) => {
//   const { id: projectId } = req.params;
//   const { title, description, status, completedAt, userId } = req.body;

//   try {
//     const existingMilestone = await AdditionalMilestone.findOne({ title, projectId });

//     if (existingMilestone) {
//       if (description) existingMilestone.description = description;
//       if (status) existingMilestone.status = status;
//       if (completedAt) existingMilestone.completedAt = completedAt;
//       if (userId) existingMilestone.userId = userId;

//       await existingMilestone.save();

//       // Create notification for milestone update
//       await ShowNotification.create({
//         title: "Milestone Updated",
//         type: "Milestone Update",
//         description: `Milestone "${title}" has been updated`,
//         memberId: userId,
//         projectId: projectId,
//       });

//       return res.status(200).json({
//         success: true,
//         message: "Milestone updated successfully",
//         data: existingMilestone,
//       });
//     }

//     const newMilestone = await AdditionalMilestone.create({
//       title,
//       description,
//       status,
//       completedAt,
//       userId,
//       projectId,
//     });

//     // Create notification for new milestone
//     await ShowNotification.create({
//       title: "New Milestone Created",
//       type: "Milestone Creation",
//       description: `New milestone "${title}" has been created`,
//       memberId: userId,
//       projectId: projectId,
//     });

//     res.status(201).json({
//       success: true,
//       message: "Milestone created successfully",
//       data: newMilestone,
//     });
//   } catch (error) {
//     console.error("Error in createOrUpdateMilestone:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

export const createOrUpdateMilestone = async (req, res) => {
  const { id: projectId } = req.params;
  const { title, description, status, completedAt, userId } = req.body;

  try {
    const { recipients, project } = await getProjectNotificationRecipients(
      projectId,
      userId
    );

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const allRecipients = [
      ...project.members,
      ...project.projectOwners.map((owner) => owner.ownerId),
    ];

    const existingMilestone = await AdditionalMilestone.findOne({
      title,
      projectId,
    });

    if (existingMilestone) {
      let emailContent = [];
      let pushNotificationChanges = [];

      if (description && description !== existingMilestone.description) {
        existingMilestone.description = description;
        emailContent.push(`Description updated to: ${description}`);
        pushNotificationChanges.push("description updated");
      }
      if (status && status !== existingMilestone.status) {
        existingMilestone.status = status;
        emailContent.push(`Status updated to: ${status}`);
        pushNotificationChanges.push(`status changed to ${status}`);
      }
      if (completedAt && completedAt !== existingMilestone.completedAt) {
        existingMilestone.completedAt = completedAt;
        emailContent.push(`Completion date updated to: ${completedAt}`);
        pushNotificationChanges.push("completion date updated");
      }
      if (userId) existingMilestone.userId = userId;

      await existingMilestone.save();

      await ShowNotification.create({
        title: `New Milestone Updated for "${title}"`,
        type: "Milestone Update",
        description: `A new document has been created to the project "${title}"`,
        lengthyDesc: `We would like to inform you that a new document has been created to the project "${title}".To view or download the document, please access the project's section on the platform.<br>Should you have any questions or require assistance, our team remains at your disposal.//
        Best regards,//
        [Soapro Team]`,
        memberId: userId,
        projectId,
      });

      // Send push notification for update
      if (recipients.length > 0) {
        await sendMilestonePushNotifications(
          recipients,
          `Milestone Updated: ${title}`,
          pushNotificationChanges.length > 0
            ? `Changes: ${pushNotificationChanges.join(", ")}`
            : `Milestone "${title}" was reviewed`,
          {
            projectId: project._id.toString(),
            milestoneId: existingMilestone._id.toString(),
            type: "MILESTONE_UPDATE",
          }
        );
      }

      // Existing email sending logic remains unchanged
      const emailPromises = allRecipients.map(async (user) => {
        if (user?.email) {
          const emailBody = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: `Milestone Updated: ${title}`,
            html: `
              <p>Dear <strong>${user.userName}</strong>,</p>
              <p>The following updates have been made to milestone "<strong>${title}</strong>" in project "<strong>${project.projectName}</strong>":</p>
              <ul>${emailContent.map((c) => `<li>${c}</li>`).join("")}</ul>
              <br />
              <p>Please log in to your dashboard to view the updates.</p>
              <p>Best regards,<br/>Your Team</p>
            `,
          };

          try {
            await SendEmailUtil(emailBody);
            console.log(`Update email sent to ${user.email}`);
          } catch (err) {
            console.error(
              `Error sending update email to ${user.email}:`,
              err.message
            );
          }
        }
      });

      await Promise.all(emailPromises);

      return res.status(200).json({
        success: true,
        message: "Milestone updated and notifications sent successfully",
        data: existingMilestone,
      });
    }

    // Create milestone
    const newMilestone = await AdditionalMilestone.create({
      title,
      description,
      status,
      completedAt,
      userId,
      projectId,
    });

    await ShowNotification.create({
      title: `New Milestone Created for "${title}"`,
      type: "Milestone Creation",
      description: `A new document has been created to the project "${title}"`,
      lengthyDesc: `We would like to inform you that a new document has been created to the project "${title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
Best regards,//
[Soapro Team]`,
      memberId: userId,
      projectId,
    });

    // Send push notification for creation
    if (recipients.length > 0) {
      await sendMilestonePushNotifications(
        recipients,
        `New Milestone: ${title}`,
        `New milestone "${title}" created in project "${project.projectName}"`,
        {
          projectId: project._id.toString(),
          milestoneId: newMilestone._id.toString(),
          type: "MILESTONE_CREATE",
        }
      );
    }

    // Existing email sending logic remains unchanged
    const creationEmailPromises = allRecipients.map(async (user) => {
      if (user?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `New Milestone Created: ${title}`,
          html: `
            <p>Dear <strong>${user.userName}</strong>,</p>
            <p>A new milestone "<strong>${title}</strong>" has been created in project "<strong>${project.projectName}</strong>".</p>
            <p><strong>Description:</strong> ${description || "N/A"}</p>
            <p><strong>Status:</strong> ${status}</p>
            <p><strong>Completed At:</strong> ${completedAt || "N/A"}</p>
            <br />
            <p>Please log in to your dashboard to view the milestone.</p>
            <p>Best regards,<br/>Your Team</p>
          `,
        };

        try {
          await SendEmailUtil(emailBody);
          console.log(`Creation email sent to ${user.email}`);
        } catch (err) {
          console.error(
            `Error sending creation email to ${user.email}:`,
            err.message
          );
        }
      }
    });

    await Promise.all(creationEmailPromises);

    res.status(201).json({
      success: true,
      message: "Milestone created and notifications sent successfully",
      data: newMilestone,
    });
  } catch (error) {
    console.error("Error in createOrUpdateMilestone:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// export const createOrUpdateMilestone = async (req, res) => {
//   const { id: projectId } = req.params;
//   const { title, description, status, completedAt, userId } = req.body;

//   try {
//     const existingMilestone = await AdditionalMilestone.findOne({
//       title,
//       projectId,
//     });

//     // Fetch project with members and owners
//     const project = await editProject
//       .findById(projectId)
//       .populate("members", "email userName")
//       .populate("projectOwners.ownerId", "email userName projectName");

//     if (!project) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Project not found" });
//     }

//     const allRecipients = [
//       ...project.members,
//       ...project.projectOwners.map((owner) => owner.ownerId),
//     ];

//     if (existingMilestone) {
//       let emailContent = [];

//       if (description && description !== existingMilestone.description) {
//         existingMilestone.description = description;
//         emailContent.push(`Description updated to: ${description}`);
//       }
//       if (status && status !== existingMilestone.status) {
//         existingMilestone.status = status;
//         emailContent.push(`Status updated to: ${status}`);
//       }
//       if (completedAt && completedAt !== existingMilestone.completedAt) {
//         existingMilestone.completedAt = completedAt;
//         emailContent.push(`Completion date updated to: ${completedAt}`);
//       }
//       if (userId) existingMilestone.userId = userId;

//       await existingMilestone.save();

//       await ShowNotification.create({
//         title: `New Milestone Updated for "${title}"`,
//         type: "Milestone Update",
//         description: `A new document has been created to the project "${title}"`,
//         lengthyDesc: `We would like to inform you that a new document has been created to the project "${title}".To view or download the document, please access the project's section on the platform.<br>Should you have any questions or require assistance, our team remains at your disposal.//
//         Best regards,//
//         [Soapro Team]`,
//         memberId: userId,
//         projectId,
//       });

//       // Send email
//       const emailPromises = allRecipients.map(async (user) => {
//         if (user?.email) {
//           const emailBody = {
//             from: process.env.EMAIL_USER,
//             to: user.email,
//             subject: `Milestone Updated: ${title}`,
//             html: `
//               <p>Dear <strong>${user.userName}</strong>,</p>
//               <p>The following updates have been made to milestone "<strong>${title}</strong>" in project "<strong>${project.projectName}</strong>":</p>
//               <ul>${emailContent.map((c) => `<li>${c}</li>`).join("")}</ul>
//               <br />
//               <p>Please log in to your dashboard to view the updates.</p>
//               <p>Best regards,<br/>Your Team</p>
//             `,
//           };

//           try {
//             await SendEmailUtil(emailBody);
//             console.log(`Update email sent to ${user.email}`);
//           } catch (err) {
//             console.error(
//               `Error sending update email to ${user.email}:`,
//               err.message
//             );
//           }
//         }
//       });

//       await Promise.all(emailPromises);

//       return res.status(200).json({
//         success: true,
//         message: "Milestone updated and emails sent successfully",
//         data: existingMilestone,
//       });
//     }

//     // Create milestone
//     const newMilestone = await AdditionalMilestone.create({
//       title,
//       description,
//       status,
//       completedAt,
//       userId,
//       projectId,
//     });

//     await ShowNotification.create({
//       title: `New Milestone Created for "${title}"`,
//       type: "Milestone Creation",
//       description: `A new document has been created to the project "${title}"`,
//       lengthyDesc: `We would like to inform you that a new document has been created to the project "${title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
// Best regards,//
// [Soapro Team]`,
//       memberId: userId,
//       projectId,
//     });

//     // Send email on milestone creation
//     const creationEmailPromises = allRecipients.map(async (user) => {
//       if (user?.email) {
//         const emailBody = {
//           from: process.env.EMAIL_USER,
//           to: user.email,
//           subject: `New Milestone Created: ${title}`,
//           html: `
//             <p>Dear <strong>${user.userName}</strong>,</p>
//             <p>A new milestone "<strong>${title}</strong>" has been created in project "<strong>${project.projectName}</strong>".</p>
//             <p><strong>Description:</strong> ${description || "N/A"}</p>
//             <p><strong>Status:</strong> ${status}</p>
//             <p><strong>Completed At:</strong> ${completedAt || "N/A"}</p>
//             <br />
//             <p>Please log in to your dashboard to view the milestone.</p>
//             <p>Best regards,<br/>Your Team</p>
//           `,
//         };

//         try {
//           await SendEmailUtil(emailBody);
//           console.log(`Creation email sent to ${user.email}`);
//         } catch (err) {
//           console.error(
//             `Error sending creation email to ${user.email}:`,
//             err.message
//           );
//         }
//       }
//     });

//     await Promise.all(creationEmailPromises);

//     res.status(201).json({
//       success: true,
//       message: "Milestone created and emails sent successfully",
//       data: newMilestone,
//     });
//   } catch (error) {
//     console.error("Error in createOrUpdateMilestone:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

export const getAllMilestones = async (req, res) => {
  const { id: projectId } = req.params;

  try {
    const milestones = await AdditionalMilestone.find({ projectId }).sort({
      createdAt: -1,
    });
    res.status(200).json({
      success: true,
      data: milestones,
    });
  } catch (error) {
    console.error("Error in getAllMilestones:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getSingleMilestone = async (req, res) => {
  const { id } = req.params;

  try {
    const milestone = await AdditionalMilestone.findById(id);
    if (!milestone) {
      return res
        .status(404)
        .json({ success: false, message: "Milestone not found" });
    }

    res.status(200).json({ success: true, data: milestone });
  } catch (error) {
    console.error("Error in getSingleMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// export const updateMilestone = async (req, res) => {
//   const { id } = req.params;
//   const updates = req.body;

//   try {
//     const updatedMilestone = await AdditionalMilestone.findByIdAndUpdate(
//       id,
//       updates,
//       { new: true }
//     );

//     if (!updatedMilestone) {
//       return res.status(404).json({ success: false, message: "Milestone not found" });
//     }

//     // Create notification for milestone update
//     await ShowNotification.create({
//       title: "Milestone Updated",
//       type: "Milestone Update",
//       description: `Milestone "${updatedMilestone.title}" has been updated`,
//       memberId: updatedMilestone.userId,
//       projectId: updatedMilestone.projectId,
//     });

//     res.status(200).json({
//       success: true,
//       message: "Milestone updated successfully",
//       data: updatedMilestone,
//     });
//   } catch (error) {
//     console.error("Error in updateMilestone:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

export const updateMilestone = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    // Find the existing milestone first
    const existingMilestone = await AdditionalMilestone.findById(id);

    if (!existingMilestone) {
      return res
        .status(404)
        .json({ success: false, message: "Milestone not found" });
    }

    // Get recipients for push notifications
    const { recipients, project } = await getProjectNotificationRecipients(
      existingMilestone.projectId,
      updates.userId || existingMilestone.userId
    );

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // Store original values to compare
    const originalTitle = existingMilestone.title;
    const originalDescription = existingMilestone.description;
    const originalStatus = existingMilestone.status;

    // Track changes for both email and push notifications
    const emailChanges = [];
    const pushNotificationChanges = [];

    // Apply updates
    if (updates.title && updates.title !== originalTitle) {
      existingMilestone.title = updates.title;
      emailChanges.push(
        `<p><strong>Title Updated:</strong> "${originalTitle}" → "${updates.title}"</p>`
      );
      pushNotificationChanges.push(`title changed to "${updates.title}"`);
    }
    if (updates.description && updates.description !== originalDescription) {
      existingMilestone.description = updates.description;
      emailChanges.push(
        `<p><strong>Description Updated:</strong> ${originalDescription || "N/A"} → ${updates.description}</p>`
      );
      pushNotificationChanges.push("description updated");
    }
    if (updates.status && updates.status !== originalStatus) {
      existingMilestone.status = updates.status;
      emailChanges.push(
        `<p><strong>Status Updated:</strong> ${originalStatus} → ${updates.status}</p>`
      );
      pushNotificationChanges.push(`status changed to ${updates.status}`);
    }
    if (updates.completedAt) {
      existingMilestone.completedAt = updates.completedAt;
      emailChanges.push(
        `<p><strong>Completion Date Updated:</strong> ${existingMilestone.completedAt} → ${updates.completedAt}</p>`
      );
      pushNotificationChanges.push("completion date updated");
    }
    if (updates.userId) {
      existingMilestone.userId = updates.userId;
      pushNotificationChanges.push("assigned user changed");
    }

    const updatedMilestone = await existingMilestone.save();

    // Create notification
    await ShowNotification.create({
      title: `New Milestone Updated for "${updatedMilestone.title}"`,
      type: "Milestone Update",
      description: `A new document has been updated to the project "${updatedMilestone.title}"`,
      lengthyDesc: `We would like to inform you that a new document has been updated to the project "${updatedMilestone.title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
Best regards,//
[Soapro Team]`,
      memberId: updatedMilestone.userId,
      projectId: updatedMilestone.projectId,
    });

    // Send push notification
    if (recipients.length > 0) {
      await sendMilestonePushNotifications(
        recipients,
        `Milestone Updated: ${updatedMilestone.title}`,
        pushNotificationChanges.length > 0
          ? `Changes: ${pushNotificationChanges.join(", ")}`
          : `Milestone "${updatedMilestone.title}" was reviewed`,
        {
          projectId: updatedMilestone.projectId.toString(),
          milestoneId: updatedMilestone._id.toString(),
          type: "MILESTONE_UPDATE",
        }
      );
    }

    // Existing email sending logic remains unchanged
    const allRecipients = [
      ...project.members,
      ...project.projectOwners.map((owner) => owner.ownerId),
    ];

    const changeMessage =
      emailChanges.length > 0
        ? emailChanges.join("")
        : "<p>No specific fields changed.</p>";

    const emailPromises = allRecipients.map(async (user) => {
      if (user?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `Milestone Updated: ${updatedMilestone.title}`,
          html: `
            <p>Dear <strong>${user.userName}</strong>,</p>
            <p>The milestone <strong>${originalTitle}</strong> in the project <strong>${project.projectName}</strong> has been updated with the following changes:</p>
            ${changeMessage}
            <br />
            <p>View more details on your dashboard.</p>
            <p>Best regards,<br />Your Team</p>
          `,
        };

        try {
          await SendEmailUtil(emailBody);
          console.log(`Update email sent to ${user.email}`);
        } catch (err) {
          console.error(`Failed to send email to ${user.email}:`, err.message);
        }
      }
    });

    await Promise.all(emailPromises);

    res.status(200).json({
      success: true,
      message: "Milestone updated and notifications sent successfully",
      data: updatedMilestone,
    });
  } catch (error) {
    console.error("Error in updateMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// export const updateMilestone = async (req, res) => {
//   const { id } = req.params;
//   const updates = req.body;

//   try {
//     // Find the existing milestone first
//     const existingMilestone = await AdditionalMilestone.findById(id);

//     if (!existingMilestone) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Milestone not found" });
//     }

//     // Store original values to compare
//     const originalTitle = existingMilestone.title;
//     const originalDescription = existingMilestone.description;
//     const originalStatus = existingMilestone.status;

//     // Apply updates
//     if (updates.title) existingMilestone.title = updates.title;
//     if (updates.description)
//       existingMilestone.description = updates.description;
//     if (updates.status) existingMilestone.status = updates.status;
//     if (updates.completedAt)
//       existingMilestone.completedAt = updates.completedAt;
//     if (updates.userId) existingMilestone.userId = updates.userId;

//     const updatedMilestone = await existingMilestone.save();

//     // Create notification
//     await ShowNotification.create({
//       title: `New Milestone Updated for "${title}"`,
//       type: "Milestone Update",
//       description: `A new document has been updated to the project "${updatedMilestone.title}"`,
//       lengthyDesc: `We would like to inform you that a new document has been updated to the project "${updatedMilestone.title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
// Best regards,//
// [Soapro Team]`,
//       memberId: updatedMilestone.userId,
//       projectId: updatedMilestone.projectId,
//     });

//     // Get project details with members and owners
//     const project = await editProject
//       .findById(updatedMilestone.projectId)
//       .populate("members", "email userName")
//       .populate("projectOwners.ownerId", "email userName");

//     if (!project) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Project not found" });
//     }

//     const allRecipients = [
//       ...project.members,
//       ...project.projectOwners.map((owner) => owner.ownerId),
//     ];

//     // Determine changes and prepare a dynamic message
//     const changes = [];
//     if (updates.title && updates.title !== originalTitle) {
//       changes.push(
//         `<p><strong>Title Updated:</strong> "${originalTitle}" → "${updates.title}"</p>`
//       );
//     }
//     if (updates.description && updates.description !== originalDescription) {
//       changes.push(
//         `<p><strong>Description Updated:</strong> ${originalDescription || "N/A"} → ${updates.description}</p>`
//       );
//     }
//     if (updates.status && updates.status !== originalStatus) {
//       changes.push(
//         `<p><strong>Status Updated:</strong> ${originalStatus} → ${updates.status}</p>`
//       );
//     }

//     const changeMessage =
//       changes.length > 0
//         ? changes.join("")
//         : "<p>No specific fields changed.</p>";

//     const emailPromises = allRecipients.map(async (user) => {
//       if (user?.email) {
//         const emailBody = {
//           from: process.env.EMAIL_USER,
//           to: user.email,
//           subject: `Milestone Updated: ${updatedMilestone.title}`,
//           html: `
//             <p>Dear <strong>${user.userName}</strong>,</p>
//             <p>The milestone <strong>${originalTitle}</strong> in the project <strong>${project.projectName}</strong> has been updated with the following changes:</p>
//             ${changeMessage}
//             <br />
//             <p>View more details on your dashboard.</p>
//             <p>Best regards,<br />Your Team</p>
//           `,
//         };

//         try {
//           await SendEmailUtil(emailBody);
//           console.log(`Update email sent to ${user.email}`);
//         } catch (err) {
//           console.error(`Failed to send email to ${user.email}:`, err.message);
//         }
//       }
//     });

//     await Promise.all(emailPromises);

//     res.status(200).json({
//       success: true,
//       message: "Milestone updated and emails sent successfully",
//       data: updatedMilestone,
//     });
//   } catch (error) {
//     console.error("Error in updateMilestone:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

// export const deleteMilestone = async (req, res) => {
//   const { id } = req.params;

//   try {
//     const deleted = await AdditionalMilestone.findByIdAndDelete(id);
//     if (!deleted) {
//       return res.status(404).json({ success: false, message: "Milestone not found" });
//     }

//     // Create notification for milestone deletion
//     await ShowNotification.create({
//       title: "Milestone Deleted",
//       type: "Milestone Deletion",
//       description: `Milestone "${deleted.title}" has been deleted`,
//       memberId: deleted.userId,
//       projectId: deleted.projectId,
//     });

//     res.status(200).json({
//       success: true,
//       message: "Milestone deleted successfully",
//     });
//   } catch (error) {
//     console.error("Error in deleteMilestone:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

export const deleteMilestone = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await AdditionalMilestone.findByIdAndDelete(id);

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Milestone not found" });
    }

    // Get recipients for push notifications
    const { recipients, project } = await getProjectNotificationRecipients(
      deleted.projectId,
      deleted.userId
    );

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // Create notification
    await ShowNotification.create({
      title: "Milestone Deleted",
      type: "Milestone Deletion",
      description: `A new document has been deleted to the project "${deleted.title}"`,
      lengthyDesc: `We would like to inform you that a new document has been deleted to the project "${deleted.title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
Best regards,//
[Soapro Team]`,
      memberId: deleted.userId,
      projectId: deleted.projectId,
    });

    // Send push notification
    if (recipients.length > 0) {
      await sendMilestonePushNotifications(
        recipients,
        `Milestone Deleted: ${deleted.title}`,
        `Milestone "${deleted.title}" was deleted from project "${project.projectName}"`,
        {
          projectId: deleted.projectId.toString(),
          deletedMilestoneId: deleted._id.toString(),
          type: "MILESTONE_DELETE",
        }
      );
    }

    // Existing email sending logic remains unchanged
    const allRecipients = [
      ...project.members,
      ...project.projectOwners.map((owner) => owner.ownerId),
    ];

    const emailPromises = allRecipients.map(async (user) => {
      if (user?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `Milestone Deleted: ${deleted.title}`,
          html: `
            <p>Dear <strong>${user.userName}</strong>,</p>
            <p>The milestone titled <strong>${deleted.title}</strong> has been deleted from the project <strong>${project.projectName}</strong>.</p>
            <br />
            <p>Please check your dashboard for updates.</p>
            <br />
            <p>Best regards,<br />Your Team</p>
          `,
        };

        try {
          await SendEmailUtil(emailBody);
          console.log(`Deletion email sent to ${user.email}`);
        } catch (err) {
          console.error(`Error sending email to ${user.email}:`, err.message);
        }
      }
    });

    await Promise.all(emailPromises);

    res.status(200).json({
      success: true,
      message: "Milestone deleted and notifications sent successfully",
    });
  } catch (error) {
    console.error("Error in deleteMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


// export const deleteMilestone = async (req, res) => {
//   const { id } = req.params;

//   try {
//     const deleted = await AdditionalMilestone.findByIdAndDelete(id);

//     if (!deleted) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Milestone not found" });
//     }

//     // Create notification
//     await ShowNotification.create({
//       title: "Milestone Deleted",
//       type: "Milestone Deletion",
//       description: `A new document has been deleted to the project "${deleted.title}"`,
//       lengthyDesc: `We would like to inform you that a new document has been deleted to the project "${deleted.title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
// Best regards,//
// [Soapro Team]`,

//       memberId: deleted.userId,
//       projectId: deleted.projectId,
//     });

//     // Fetch project to get members and owners
//     const project = await editProject
//       .findById(deleted.projectId)
//       .populate("members", "email userName")
//       .populate("projectOwners.ownerId", "email userName");

//     if (!project) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Project not found" });
//     }

//     const allRecipients = [
//       ...project.members,
//       ...project.projectOwners.map((owner) => owner.ownerId),
//     ];

//     const emailPromises = allRecipients.map(async (user) => {
//       if (user?.email) {
//         const emailBody = {
//           from: process.env.EMAIL_USER,
//           to: user.email,
//           subject: `Milestone Deleted: ${deleted.title}`,
//           html: `
//             <p>Dear <strong>${user.userName}</strong>,</p>
//             <p>The milestone titled <strong>${deleted.title}</strong> has been deleted from the project <strong>${project.projectName}</strong>.</p>
//             <br />
//             <p>Please check your dashboard for updates.</p>
//             <br />
//             <p>Best regards,<br />Your Team</p>
//           `,
//         };

//         try {
//           await SendEmailUtil(emailBody);
//           console.log(`Deletion email sent to ${user.email}`);
//         } catch (err) {
//           console.error(`Error sending email to ${user.email}:`, err.message);
//         }
//       }
//     });

//     await Promise.all(emailPromises);

//     res.status(200).json({
//       success: true,
//       message: "Milestone deleted and emails sent successfully",
//     });
//   } catch (error) {
//     console.error("Error in deleteMilestone:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

export const getUserMilestones = async (req, res) => {
  const { id: userId } = req.params;

  try {
    const milestones = await AdditionalMilestone.find({ userId }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      data: milestones,
    });
  } catch (error) {
    console.error("Error in getUserMilestones:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
