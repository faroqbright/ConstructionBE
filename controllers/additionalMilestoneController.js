import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";

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
    const existingMilestone = await AdditionalMilestone.findOne({
      title,
      projectId,
    });

    // Fetch project with members and owners
    const project = await editProject
      .findById(projectId)
      .populate("members", "email userName")
      .populate("projectOwners.ownerId", "email userName projectName");

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const allRecipients = [
      ...project.members,
      ...project.projectOwners.map((owner) => owner.ownerId),
    ];

    if (existingMilestone) {
      let emailContent = [];

      if (description && description !== existingMilestone.description) {
        existingMilestone.description = description;
        emailContent.push(`Description updated to: ${description}`);
      }
      if (status && status !== existingMilestone.status) {
        existingMilestone.status = status;
        emailContent.push(`Status updated to: ${status}`);
      }
      if (completedAt && completedAt !== existingMilestone.completedAt) {
        existingMilestone.completedAt = completedAt;
        emailContent.push(`Completion date updated to: ${completedAt}`);
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

      // Send email
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
        message: "Milestone updated and emails sent successfully",
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

    // Send email on milestone creation
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
      message: "Milestone created and emails sent successfully",
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

    // Store original values to compare
    const originalTitle = existingMilestone.title;
    const originalDescription = existingMilestone.description;
    const originalStatus = existingMilestone.status;

    // Apply updates
    if (updates.title) existingMilestone.title = updates.title;
    if (updates.description)
      existingMilestone.description = updates.description;
    if (updates.status) existingMilestone.status = updates.status;
    if (updates.completedAt)
      existingMilestone.completedAt = updates.completedAt;
    if (updates.userId) existingMilestone.userId = updates.userId;

    const updatedMilestone = await existingMilestone.save();

    // Create notification
    await ShowNotification.create({
      title: `New Milestone Updated for "${title}"`,
      type: "Milestone Update",
      description: `A new document has been updated to the project "${updatedMilestone.title}"`,
      lengthyDesc: `We would like to inform you that a new document has been updated to the project "${updatedMilestone.title}".To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.//
Best regards,//
[Soapro Team]`,
      memberId: updatedMilestone.userId,
      projectId: updatedMilestone.projectId,
    });

    // Get project details with members and owners
    const project = await editProject
      .findById(updatedMilestone.projectId)
      .populate("members", "email userName")
      .populate("projectOwners.ownerId", "email userName");

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const allRecipients = [
      ...project.members,
      ...project.projectOwners.map((owner) => owner.ownerId),
    ];

    // Determine changes and prepare a dynamic message
    const changes = [];
    if (updates.title && updates.title !== originalTitle) {
      changes.push(
        `<p><strong>Title Updated:</strong> "${originalTitle}" → "${updates.title}"</p>`
      );
    }
    if (updates.description && updates.description !== originalDescription) {
      changes.push(
        `<p><strong>Description Updated:</strong> ${originalDescription || "N/A"} → ${updates.description}</p>`
      );
    }
    if (updates.status && updates.status !== originalStatus) {
      changes.push(
        `<p><strong>Status Updated:</strong> ${originalStatus} → ${updates.status}</p>`
      );
    }

    const changeMessage =
      changes.length > 0
        ? changes.join("")
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
      message: "Milestone updated and emails sent successfully",
      data: updatedMilestone,
    });
  } catch (error) {
    console.error("Error in updateMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

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

    // Fetch project to get members and owners
    const project = await editProject
      .findById(deleted.projectId)
      .populate("members", "email userName")
      .populate("projectOwners.ownerId", "email userName");

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

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
      message: "Milestone deleted and emails sent successfully",
    });
  } catch (error) {
    console.error("Error in deleteMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

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
