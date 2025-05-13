import { BusinessArea } from "../models/businessAreasModal.js";
import { User } from "../models/user.model.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

// Helper function to get user language preference
async function getUserLanguage(userId) {
  const preference = await LanguagePreference.findOne({ userId }).lean();
  return preference?.languageSelected || "portuguese"; // Default to Portuguese
}

// Helper function to get admin users (ID and token) for notifications
const getAdminUsersForNotifications = async () => {
  try {
    const adminUsers = await User.find({ isMain: true })
      .select("_id notificationToken fcmDeviceToken userName email")
      .lean();

    return adminUsers
      .map((user) => ({
        _id: user._id,
        userName: user.userName,
        email: user.email,
        notificationToken: user.notificationToken || user.fcmDeviceToken,
      }))
      .filter((user) => user._id);
  } catch (error) {
    console.error("Error fetching admin users for notifications:", error);
    return [];
  }
};

// Helper function to send localized business area push notifications to all admins
const sendBusinessAreaPushNotifications = async (title, body, data) => {
  try {
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length === 0) {
      console.warn(
        "[Business Area Push] No admin users found or no tokens available."
      );
      return;
    }

    // Group recipients by language
    const recipientsByLanguage = {
      portuguese: [],
      english: [],
    };

    // Get language preferences for all recipients
    const languagePromises = adminRecipients.map(async (user) => {
      const language = await getUserLanguage(user._id);
      return { user, language };
    });

    const usersWithLanguage = await Promise.all(languagePromises);

    usersWithLanguage.forEach(({ user, language }) => {
      if (language === "portuguese") {
        recipientsByLanguage.portuguese.push(user);
      } else {
        recipientsByLanguage.english.push(user);
      }
    });

    // Send notifications for each language group
    const sendPromises = [];

    if (recipientsByLanguage.portuguese.length > 0) {
      const portugueseTokens = recipientsByLanguage.portuguese
        .map((r) => r.notificationToken)
        .filter(Boolean);

      if (portugueseTokens.length > 0) {
        const portugueseTitle =
          typeof title === "object" ? title.portuguese : title;
        const portugueseBody =
          typeof body === "object" ? body.portuguese : body;

        sendPromises.push(
          sendPushNotification(
            portugueseTokens,
            portugueseTitle,
            portugueseBody,
            data
          )
        );
      }
    }

    if (recipientsByLanguage.english.length > 0) {
      const englishTokens = recipientsByLanguage.english
        .map((r) => r.notificationToken)
        .filter(Boolean);

      if (englishTokens.length > 0) {
        const englishTitle = typeof title === "object" ? title.english : title;
        const englishBody = typeof body === "object" ? body.english : body;

        sendPromises.push(
          sendPushNotification(englishTokens, englishTitle, englishBody, data)
        );
      }
    }

    await Promise.all(sendPromises);
  } catch (error) {
    console.error("Error sending business area push notifications:", error);
  }
};

// Helper function to send business area emails with language support
async function sendBusinessAreaEmail(
  recipients,
  businessArea,
  performingUser,
  actionType
) {
  const emailPromises = recipients.map(async (user) => {
    if (!user.email) return;

    const userLanguage = await getUserLanguage(user._id);
    const isPortuguese = userLanguage === "portuguese";

    let subject, html;

    if (actionType === "creation") {
      subject = isPortuguese
        ? `Nova Área de Negócio Criada: ${businessArea.businessArea}`
        : `New Business Area Created: ${businessArea.businessArea}`;

      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>Uma nova área de negócio "<strong>${businessArea.businessArea}</strong>" foi criada por <strong>${performingUser.userName}</strong>.</p>
          <p>Esta área de negócio está agora disponível para atribuição a projetos.</p>
          <br />
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>A new business area "<strong>${businessArea.businessArea}</strong>" has been created by <strong>${performingUser.userName}</strong>.</p>
          <p>This business area is now available for project assignment.</p>
          <br />
          <p>Best regards,<br/>Soapro Team</p>
        `;
    } else if (actionType === "update") {
      subject = isPortuguese
        ? `Área de Negócio Atualizada: ${businessArea.businessArea}`
        : `Business Area Updated: ${businessArea.businessArea}`;

      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>A área de negócio "<strong>${businessArea.businessArea}</strong>" foi atualizada por <strong>${performingUser.userName}</strong>.</p>
          <p>Por favor, verifique o sistema para ver as alterações.</p>
          <br />
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>The business area "<strong>${businessArea.businessArea}</strong>" has been updated by <strong>${performingUser.userName}</strong>.</p>
          <p>Please check the system for changes.</p>
          <br />
          <p>Best regards,<br/>Soapro Team</p>
        `;
    } else if (actionType === "deletion") {
      subject = isPortuguese
        ? `Área de Negócio Removida: ${businessArea.businessArea}`
        : `Business Area Deleted: ${businessArea.businessArea}`;

      html = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName}</strong>,</p>
          <p>A área de negócio "<strong>${businessArea.businessArea}</strong>" foi removida por <strong>${performingUser.userName}</strong>.</p>
          <p>Esta área não estará mais disponível para novos projetos.</p>
          <br />
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName}</strong>,</p>
          <p>The business area "<strong>${businessArea.businessArea}</strong>" has been deleted by <strong>${performingUser.userName}</strong>.</p>
          <p>This area will no longer be available for new projects.</p>
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

// Create or Update Business Area
export const createOrUpdateBusinessArea = async (req, res) => {
  const { businessArea, role } = req.body;
  const performingUser = req.user;
  const performingUserId = performingUser?._id;
  const performingUserName = performingUser?.userName || "System";

  try {
    if (!businessArea) {
      return res
        .status(400)
        .json({ success: false, message: "Business Area is required" });
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
        role,
      });
      isNew = true;
      actionVerb = "created";
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      // Create localized notifications
      const notificationPromises = adminRecipients.map(async (admin) => {
        const userLanguage = await getUserLanguage(admin._id);
        const isPortuguese = userLanguage === "portuguese";

        return {
          title: isPortuguese
            ? isNew
              ? `Nova Área de Negócio Criada`
              : `Área de Negócio Atualizada`
            : isNew
              ? `New Business Area Created`
              : `Business Area Updated`,
          type: "Business Area Event Updated",
          description: isPortuguese
            ? `Área de negócio "${businessAreaData.businessArea}" foi ${isNew ? "criada" : "atualizada"} por ${performingUserName}.`
            : `Business area "${businessAreaData.businessArea}" was ${actionVerb} by ${performingUserName}.`,
          lengthyDesc: isPortuguese
            ? `A área de negócio "${businessAreaData.businessArea}" foi ${isNew ? "adicionada ao" : "atualizada no"} sistema por ${performingUserName}.`
            : `The business area "${businessAreaData.businessArea}" was ${actionVerb} in the system by ${performingUserName}.`,
          memberId: admin._id,
          relatedId: businessAreaData._id,
          relatedModel: "BusinessArea",
        };
      });

      const notifications = await Promise.all(notificationPromises);
      await ShowNotification.create(notifications);

      // Push notifications
      await sendBusinessAreaPushNotifications(
        {
          portuguese: isNew
            ? `Nova Área de Negócio`
            : `Área de Negócio Atualizada`,
          english: isNew ? `New Business Area` : `Business Area Updated`,
        },
        {
          portuguese: `"${businessAreaData.businessArea}" foi ${isNew ? "criada" : "atualizada"}.`,
          english: `"${businessAreaData.businessArea}" was ${actionVerb}.`,
        },
        {
          type: isNew ? "Business Area Created" : "Business Area Updated",
          businessAreaId: businessAreaData._id.toString(),
          businessAreaName: businessAreaData.businessArea,
        }
      );

      // Send emails
      await sendBusinessAreaEmail(
        adminRecipients,
        businessAreaData,
        performingUser,
        isNew ? "creation" : "update"
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
    const businessAreas = await BusinessArea.find(
      {},
      "businessArea role createdAt"
    ).populate("role");
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
    const businessArea = await BusinessArea.findById(
      id,
      "businessArea createdAt"
    );
    if (!businessArea) {
      return res
        .status(404)
        .json({ success: false, message: "Business Area not found" });
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
  const performingUserName = performingUser?.userName || "System";

  try {
    if (!businessArea) {
      return res
        .status(400)
        .json({ success: false, message: "Business Area is required" });
    }

    const updated = await BusinessArea.findByIdAndUpdate(
      id,
      { businessArea },
      { new: true, fields: "businessArea createdAt" }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Business Area not found" });
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      // Create localized notifications
      const notificationPromises = adminRecipients.map(async (admin) => {
        const userLanguage = await getUserLanguage(admin._id);
        const isPortuguese = userLanguage === "portuguese";

        return {
          title: isPortuguese
            ? `Área de Negócio Atualizada`
            : `Business Area Updated`,
          type: "Business Area Event Updated",
          description: isPortuguese
            ? `Área de negócio "${updated.businessArea}" foi atualizada por ${performingUserName}.`
            : `Business area "${updated.businessArea}" was updated by ${performingUserName}.`,
          lengthyDesc: isPortuguese
            ? `A área de negócio "${updated.businessArea}" foi modificada no sistema por ${performingUserName}.`
            : `The business area "${updated.businessArea}" was modified in the system by ${performingUserName}.`,
          memberId: admin._id,
          relatedId: updated._id,
          relatedModel: "BusinessArea",
        };
      });

      const notifications = await Promise.all(notificationPromises);
      await ShowNotification.create(notifications);

      // Push notifications
      await sendBusinessAreaPushNotifications(
        {
          portuguese: `Área de Negócio Atualizada`,
          english: `Business Area Updated`,
        },
        {
          portuguese: `"${updated.businessArea}" foi atualizada.`,
          english: `"${updated.businessArea}" was updated.`,
        },
        {
          type: "Business Area Event Updated",
          businessAreaId: updated._id.toString(),
          businessAreaName: updated.businessArea,
        }
      );

      // Send emails
      await sendBusinessAreaEmail(
        adminRecipients,
        updated,
        performingUser,
        "update"
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
  const performingUserName = performingUser?.userName || "System";

  try {
    const deleted = await BusinessArea.findByIdAndDelete(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Business Area not found" });
    }

    // Notification Logic
    const adminRecipients = await getAdminUsersForNotifications();

    if (adminRecipients.length > 0) {
      // Create localized notifications
      const notificationPromises = adminRecipients.map(async (admin) => {
        const userLanguage = await getUserLanguage(admin._id);
        const isPortuguese = userLanguage === "portuguese";

        return {
          title: isPortuguese
            ? `Área de Negócio Removida`
            : `Business Area Deleted`,
          type: "Business Area Event Updated",
          description: isPortuguese
            ? `Área de negócio "${deleted.businessArea}" foi removida por ${performingUserName}.`
            : `Business area "${deleted.businessArea}" was deleted by ${performingUserName}.`,
          lengthyDesc: isPortuguese
            ? `A área de negócio "${deleted.businessArea}" foi permanentemente removida do sistema por ${performingUserName}.`
            : `The business area "${deleted.businessArea}" was permanently removed from the system by ${performingUserName}.`,
          memberId: admin._id,
          relatedModel: "BusinessArea",
        };
      });

      const notifications = await Promise.all(notificationPromises);
      await ShowNotification.create(notifications);

      // Push notifications
      await sendBusinessAreaPushNotifications(
        {
          portuguese: `Área de Negócio Removida`,
          english: `Business Area Deleted`,
        },
        {
          portuguese: `Área de negócio "${deleted.businessArea}" foi removida.`,
          english: `Business area "${deleted.businessArea}" was deleted.`,
        },
        {
          type: "Business Area Event Deleted",
          businessAreaName: deleted.businessArea,
        }
      );

      // Send emails
      await sendBusinessAreaEmail(
        adminRecipients,
        deleted,
        performingUser,
        "deletion"
      );
    }

    res
      .status(200)
      .json({ success: true, message: "Business Area deleted successfully" });
  } catch (error) {
    console.error("Error in deleteBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
