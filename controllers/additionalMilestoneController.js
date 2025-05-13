import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { User } from "../models/user.model.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

// Helper function to get user language preference
async function getUserLanguage(userId) {
  const preference = await LanguagePreference.findOne({ userId }).lean();
  return preference?.languageSelected || 'portuguese'; // Default to Portuguese
}

// Helper function to get language-specific content
function getLocalizedContent(userLanguage, content) {
  return content[userLanguage] || content.portuguese; // Fallback to Portuguese
}

// Enhanced getProjectNotificationRecipients with language preference
const getProjectNotificationRecipients = async (
  projectId,
  performingUserId
) => {
  console.log(`[Notification] Getting recipients for project ${projectId}`);

  const project = await editProject
    .findById(projectId)
    .populate("members", "_id notificationToken fcmDeviceToken email userName")
    .populate("projectOwners.ownerId", "_id notificationToken fcmDeviceToken email userName");

  if (!project) {
    console.error("[Notification] Project not found");
    return { recipients: [], recipientIds: new Set() };
  }

  const recipientUserObjects = [];
  const recipientUserObjectIds = new Set();

  // Process members
  project.members?.forEach((member) => {
    if (member?._id) {
      const token = member.notificationToken || member.fcmDeviceToken;
      recipientUserObjects.push({
        ...member.toObject(),
        effectiveToken: token,
      });
      recipientUserObjectIds.add(member._id.toString());
    }
  });

  // Process owners
  project.projectOwners?.forEach((ownerObj) => {
    if (ownerObj?.ownerId?._id) {
      const token =
        ownerObj.ownerId.notificationToken || ownerObj.ownerId.fcmDeviceToken;
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
    const performer = await User.findById(performingUserId)
      .select("_id notificationToken fcmDeviceToken email userName")
      .lean();
    if (performer) {
      const token = performer.notificationToken || performer.fcmDeviceToken;
      recipientUserObjects.push({
        ...performer,
        effectiveToken: token,
      });
      recipientUserObjectIds.add(performer._id.toString());
    }
  }

  return {
    recipients: recipientUserObjects,
    recipientIds: recipientUserObjectIds,
    project,
  };
};

// Enhanced sendMilestonePushNotifications with language support
const sendMilestonePushNotifications = async (
  recipients,
  title,
  body,
  data
) => {
  try {
    // Group recipients by language
    const recipientsByLanguage = {
      portuguese: [],
      english: []
    };

    // Get language preferences for all recipients
    const languagePromises = recipients.map(async (user) => {
      const language = await getUserLanguage(user._id);
      return { user, language };
    });

    const usersWithLanguage = await Promise.all(languagePromises);

    usersWithLanguage.forEach(({ user, language }) => {
      if (language === 'portuguese') {
        recipientsByLanguage.portuguese.push(user);
      } else {
        recipientsByLanguage.english.push(user);
      }
    });

    // Send notifications for each language group
    const sendPromises = [];
    
    if (recipientsByLanguage.portuguese.length > 0) {
      const portugueseTokens = [
        ...new Set(
          recipientsByLanguage.portuguese
            .map((user) => user.effectiveToken)
            .filter(Boolean)
        ),
      ];
      
      if (portugueseTokens.length > 0) {
        const portugueseTitle = typeof title === 'object' ? title.portuguese : title;
        const portugueseBody = typeof body === 'object' ? body.portuguese : body;
        
        sendPromises.push(
          sendPushNotification(portugueseTokens, portugueseTitle, portugueseBody, data)
        );
      }
    }

    if (recipientsByLanguage.english.length > 0) {
      const englishTokens = [
        ...new Set(
          recipientsByLanguage.english
            .map((user) => user.effectiveToken)
            .filter(Boolean)
        ),
      ];
      
      if (englishTokens.length > 0) {
        const englishTitle = typeof title === 'object' ? title.english : title;
        const englishBody = typeof body === 'object' ? body.english : body;
        
        sendPromises.push(
          sendPushNotification(englishTokens, englishTitle, englishBody, data)
        );
      }
    }

    await Promise.all(sendPromises);
  } catch (error) {
    console.error("[Push Notification] Error:", error);
    throw error;
  }
};

// Helper function to send milestone emails with language support
async function sendMilestoneEmail(recipients, milestone, project, type, changes = []) {
  const emailPromises = recipients.map(async (user) => {
    if (!user.email) return;

    const userLanguage = await getUserLanguage(user._id);
    const isPortuguese = userLanguage === 'portuguese';

    let subject, html;

    if (type === 'creation') {
      subject = isPortuguese 
        ? `Novo Marco Criado: ${milestone.title}`
        : `New Milestone Created: ${milestone.title}`;
      
      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>Um novo marco "<strong>${milestone.title}</strong>" foi criado no projeto "<strong>${project.projectName}</strong>".</p>
          <p><strong>Descrição:</strong> ${milestone.description || "N/A"}</p>
          <p><strong>Status:</strong> ${milestone.status}</p>
          <p><strong>Data de Conclusão:</strong> ${milestone.completedAt || "N/A"}</p>
          <br />
          <p>Por favor, acesse seu painel para visualizar o marco.</p>
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>A new milestone "<strong>${milestone.title}</strong>" has been created in project "<strong>${project.projectName}</strong>".</p>
          <p><strong>Description:</strong> ${milestone.description || "N/A"}</p>
          <p><strong>Status:</strong> ${milestone.status}</p>
          <p><strong>Completed At:</strong> ${milestone.completedAt || "N/A"}</p>
          <br />
          <p>Please log in to your dashboard to view the milestone.</p>
          <p>Best regards,<br/>Soapro Team</p>
        `;
    } else if (type === 'update') {
      subject = isPortuguese
        ? `Marco Actualizado : ${milestone.title}`
        : `Milestone Updated: ${milestone.title}`;
      
      const changesText = changes.length > 0
        ? isPortuguese
          ? `<p>As seguintes alterações foram feitas:</p><ul>${changes.map(c => `<li>${c}</li>`).join('')}</ul>`
          : `<p>The following changes have been made:</p><ul>${changes.map(c => `<li>${c}</li>`).join('')}</ul>`
        : isPortuguese
          ? '<p>Nenhum campo específico foi alterado.</p>'
          : '<p>No specific fields were changed.</p>';
      
      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>O marco "<strong>${milestone.title}</strong>" no projeto "<strong>${project.projectName}</strong>" foi Actualizado .</p>
          ${changesText}
          <br />
          <p>Acesse seu painel para mais detalhes.</p>
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>The milestone "<strong>${milestone.title}</strong>" in project "<strong>${project.projectName}</strong>" has been updated.</p>
          ${changesText}
          <br />
          <p>View more details on your dashboard.</p>
          <p>Best regards,<br/>Soapro Team</p>
        `;
    } else if (type === 'deletion') {
      subject = isPortuguese
        ? `Marco Eliminado: ${milestone.title}`
        : `Milestone Deleted: ${milestone.title}`;
      
      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>O marco "<strong>${milestone.title}</strong>" foi removido do projeto "<strong>${project.projectName}</strong>".</p>
          <br />
          <p>Verifique seu painel para atualizações.</p>
          <br />
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>The milestone "<strong>${milestone.title}</strong>" has been deleted from project "<strong>${project.projectName}</strong>".</p>
          <br />
          <p>Please check your dashboard for updates.</p>
          <br />
          <p>Best regards,<br/>Soapro Team</p>
        `;
    }

    try {
      await SendEmailUtil({
        from: process.env.EMAIL_FROM || "noreply@soapro.com",
        to: user.email,
        subject,
        html,
      });
    } catch (err) {
      console.error(`Error sending email to ${user.email}:`, err.message);
    }
  });

  await Promise.all(emailPromises);
}

// Enhanced createOrUpdateMilestone with full language support
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

    const existingMilestone = await AdditionalMilestone.findOne({
      title,
      projectId,
    });

    if (existingMilestone) {
      // Update existing milestone
      let emailChanges = [];
      let pushNotificationChanges = [];

      if (description && description !== existingMilestone.description) {
        existingMilestone.description = description;
        emailChanges.push(
          `Descrição atualizada para: ${description}`,
          `Description updated to: ${description}`
        );
        pushNotificationChanges.push("description updated");
      }
      if (status && status !== existingMilestone.status) {
        existingMilestone.status = status;
        emailChanges.push(
          `Status Actualizado para: ${status}`,
          `Status updated to: ${status}`
        );
        pushNotificationChanges.push(`status changed to ${status}`);
      }
      if (completedAt && completedAt !== existingMilestone.completedAt) {
        existingMilestone.completedAt = completedAt;
        emailChanges.push(
          `Data de conclusão atualizada para: ${completedAt}`,
          `Completion date updated to: ${completedAt}`
        );
        pushNotificationChanges.push("completion date updated");
      }
      if (userId) existingMilestone.userId = userId;

      const updatedMilestone = await existingMilestone.save();

      // Create localized notification
      const notificationPromises = recipients.map(async (user) => {
        const userLanguage = await getUserLanguage(user._id);
        const isPortuguese = userLanguage === 'portuguese';

        return {
          title: isPortuguese
            ? `Marco Actualizado : ${title}`
            : `Milestone Updated: ${title}`,
          type: "Milestone Update",
          description: isPortuguese
            ? `Um marco foi Actualizado no projeto "${title}"`
            : `A milestone was updated in project "${title}"`,
          lengthyDesc: isPortuguese
            ? `Informamos que o marco "${title}" foi Actualizado no projeto. Para visualizar as alterações, acesse a seção do projeto na plataforma.<br>Em caso de dúvidas ou necessidade de assistência, nossa equipe está à disposição.//
            Atenciosamente,//
            [Equipe Soapro]`
            : `We would like to inform you that the milestone "${title}" has been updated in the project. To view the changes, please access the project section on the platform.<br>Should you have any questions or require assistance, our team remains at your disposal.//
            Best regards,//
            [Soapro Team]`,
          memberId: user._id,
          projectId,
        };
      });

      const notifications = await Promise.all(notificationPromises);
      await ShowNotification.create(notifications);

      // Send push notifications
      await sendMilestonePushNotifications(
        recipients,
        {
          portuguese: `Marco Actualizado : ${title}`,
          english: `Milestone Updated: ${title}`
        },
        {
          portuguese: pushNotificationChanges.length > 0
            ? `Alterações: ${pushNotificationChanges.join(", ")}`
            : `O marco "${title}" foi revisado`,
          english: pushNotificationChanges.length > 0
            ? `Changes: ${pushNotificationChanges.join(", ")}`
            : `Milestone "${title}" was reviewed`
        },
        {
          projectId: project._id.toString(),
          milestoneId: updatedMilestone._id.toString(),
          type: "Milestone Update",
        }
      );

      // Send emails
      await sendMilestoneEmail(
        recipients,
        updatedMilestone,
        project,
        'update',
        emailChanges
      );

      return res.status(200).json({
        success: true,
        message: "Milestone updated and notifications sent successfully",
        data: updatedMilestone,
      });
    }

    // Create new milestone
    const newMilestone = await AdditionalMilestone.create({
      title,
      description,
      status,
      completedAt,
      userId,
      projectId,
    });

    // Create localized notifications
    const notificationPromises = recipients.map(async (user) => {
      const userLanguage = await getUserLanguage(user._id);
      const isPortuguese = userLanguage === 'portuguese';

      return {
        title: isPortuguese
          ? `Novo Marco Criado: ${title}`
          : `New Milestone Created: ${title}`,
        type: "Milestone Creation",
        description: isPortuguese
          ? `Um novo marco foi criado no projeto "${title}"`
          : `A new milestone was created in project "${title}"`,
        lengthyDesc: isPortuguese
          ? `Informamos que um novo marco "${title}" foi criado no projeto. Para visualizá-lo, acesse a seção do projeto na plataforma.<br>Em caso de dúvidas ou necessidade de assistência, nossa equipe está à disposição.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that a new milestone "${title}" has been created in the project. To view it, please access the project section on the platform.<br>Should you have any questions or require assistance, our team remains at your disposal.//
          Best regards,//
          [Soapro Team]`,
        memberId: user._id,
        projectId,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications);

    // Send push notifications
    await sendMilestonePushNotifications(
      recipients,
      {
        portuguese: `Novo Marco: ${title}`,
        english: `New Milestone: ${title}`
      },
      {
        portuguese: `Novo marco "${title}" criado no projeto "${project.projectName}"`,
        english: `New milestone "${title}" created in project "${project.projectName}"`
      },
      {
        projectId: project._id.toString(),
        milestoneId: newMilestone._id.toString(),
        type: "Milestone Creation",
      }
    );

    // Send emails
    await sendMilestoneEmail(
      recipients,
      newMilestone,
      project,
      'creation'
    );

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

// Enhanced updateMilestone with full language support
export const updateMilestone = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const existingMilestone = await AdditionalMilestone.findById(id);

    if (!existingMilestone) {
      return res
        .status(404)
        .json({ success: false, message: "Milestone not found" });
    }

    const { recipients, project } = await getProjectNotificationRecipients(
      existingMilestone.projectId,
      updates.userId || existingMilestone.userId
    );

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // Track changes for both languages
    const changes = {
      portuguese: [],
      english: []
    };

    if (updates.title && updates.title !== existingMilestone.title) {
      changes.portuguese.push(`Título Actualizado de "${existingMilestone.title}" para "${updates.title}"`);
      changes.english.push(`Title updated from "${existingMilestone.title}" to "${updates.title}"`);
      existingMilestone.title = updates.title;
    }
    if (updates.description && updates.description !== existingMilestone.description) {
      changes.portuguese.push(`Descrição atualizada para: ${updates.description}`);
      changes.english.push(`Description updated to: ${updates.description}`);
      existingMilestone.description = updates.description;
    }
    if (updates.status && updates.status !== existingMilestone.status) {
      changes.portuguese.push(`Status Actualizado para: ${updates.status}`);
      changes.english.push(`Status updated to: ${updates.status}`);
      existingMilestone.status = updates.status;
    }
    if (updates.completedAt) {
      changes.portuguese.push(`Data de conclusão atualizada para: ${updates.completedAt}`);
      changes.english.push(`Completion date updated to: ${updates.completedAt}`);
      existingMilestone.completedAt = updates.completedAt;
    }
    if (updates.userId) {
      existingMilestone.userId = updates.userId;
    }

    const updatedMilestone = await existingMilestone.save();

    // Create localized notifications
    const notificationPromises = recipients.map(async (user) => {
      const userLanguage = await getUserLanguage(user._id);
      const isPortuguese = userLanguage === 'portuguese';

      return {
        title: isPortuguese
          ? `Marco Actualizado : ${updatedMilestone.title}`
          : `Milestone Updated: ${updatedMilestone.title}`,
        type: "Milestone Update",
        description: isPortuguese
          ? `O marco foi Actualizado no projeto "${updatedMilestone.title}"`
          : `The milestone was updated in project "${updatedMilestone.title}"`,
        lengthyDesc: isPortuguese
          ? `Informamos que o marco "${updatedMilestone.title}" foi Actualizado no projeto. Alterações: ${changes.portuguese.join(", ")}.<br>Acesse a plataforma para mais detalhes.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that the milestone "${updatedMilestone.title}" has been updated in the project. Changes: ${changes.english.join(", ")}.<br>Please access the platform for more details.//
          Best regards,//
          [Soapro Team]`,
        memberId: user._id,
        projectId: updatedMilestone.projectId,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications);

    // Send push notifications
    await sendMilestonePushNotifications(
      recipients,
      {
        portuguese: `Marco Actualizado : ${updatedMilestone.title}`,
        english: `Milestone Updated: ${updatedMilestone.title}`
      },
      {
        portuguese: changes.portuguese.length > 0
          ? `Alterações: ${changes.portuguese.join(", ")}`
          : `O marco "${updatedMilestone.title}" foi revisado`,
        english: changes.english.length > 0
          ? `Changes: ${changes.english.join(", ")}`
          : `Milestone "${updatedMilestone.title}" was reviewed`
      },
      {
        projectId: updatedMilestone.projectId.toString(),
        milestoneId: updatedMilestone._id.toString(),
        type: "Milestone Update",
      }
    );

    // Send emails
    await sendMilestoneEmail(
      recipients,
      updatedMilestone,
      project,
      'update',
      changes.portuguese // For Portuguese users
    );

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

// Enhanced deleteMilestone with full language support
export const deleteMilestone = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await AdditionalMilestone.findByIdAndDelete(id);

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Milestone not found" });
    }

    const { recipients, project } = await getProjectNotificationRecipients(
      deleted.projectId,
      deleted.userId
    );

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // Create localized notifications
    const notificationPromises = recipients.map(async (user) => {
      const userLanguage = await getUserLanguage(user._id);
      const isPortuguese = userLanguage === 'portuguese';

      return {
        title: isPortuguese
          ? `Marco Eliminado: ${deleted.title}`
          : `Milestone Deleted: ${deleted.title}`,
        type: "Milestone Deletion",
        description: isPortuguese
          ? `Um marco foi removido do projeto "${deleted.title}"`
          : `A milestone was removed from project "${deleted.title}"`,
        lengthyDesc: isPortuguese
          ? `Informamos que o marco "${deleted.title}" foi removido do projeto. Todos os dados associados foram eliminados do sistema.<br>Em caso de dúvidas, nossa equipe está à disposição.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that the milestone "${deleted.title}" has been removed from the project. All associated data has been deleted from the system.<br>Should you have any questions, our team remains at your disposal.//
          Best regards,//
          [Soapro Team]`,
        memberId: user._id,
        projectId: deleted.projectId,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications);

    // Send push notifications
    await sendMilestonePushNotifications(
      recipients,
      {
        portuguese: `Marco Eliminado: ${deleted.title}`,
        english: `Milestone Deleted: ${deleted.title}`
      },
      {
        portuguese: `O marco "${deleted.title}" foi removido do projeto "${project.projectName}"`,
        english: `The milestone "${deleted.title}" was deleted from project "${project.projectName}"`
      },
      {
        projectId: deleted.projectId.toString(),
        deletedMilestoneId: deleted._id.toString(),
        type: "Milestone Deletion",
      }
    );

    // Send emails
    await sendMilestoneEmail(
      recipients,
      deleted,
      project,
      'deletion'
    );

    res.status(200).json({
      success: true,
      message: "Milestone deleted and notifications sent successfully",
    });
  } catch (error) {
    console.error("Error in deleteMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Other functions remain unchanged as they don't involve notifications
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