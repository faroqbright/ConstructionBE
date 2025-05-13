import mongoose from "mongoose"
import FinanceDocument from "../models/finance.model.js"
import { editProject } from "../models/project.model.js"
import { User } from "../models/user.model.js" // Added for push notifications
import { SendEmailUtil } from "../utils/emailsender.js"
import { ShowNotification } from "../models/showNotificationSchema.js"
// --- ADDED FOR PUSH NOTIFICATIONS ---
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js"
// --- ADDED FOR S3 (assuming path) ---
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js"

// Helper function to get FCM tokens from User model
const getFcmTokensForUser = async (userId) => {
  try {
    const user = await User.findById(userId)
      .select("notificationToken fcmDeviceToken") // Check both common fields
      .lean()

    if (!user) {
      console.warn(`getFcmTokensForUser: User not found for ID ${userId}`)
      return []
    }

    // Prefer notificationToken if available, otherwise fcmDeviceToken
    const token = user.notificationToken || user.fcmDeviceToken
    return token ? [token] : []
  } catch (error) {
    console.error(`Error getting FCM tokens for user ${userId}:`, error)
    return []
  }
}

// Helper function to send push notifications to specific users
const sendPushNotificationsToUsers = async (userIds, title, body, data) => {
  try {
    if (!userIds || userIds.length === 0) {
      console.warn("No user IDs provided for push notifications.")
      return
    }

    const validUserIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
    if (validUserIds.length === 0) {
      console.warn("No valid user IDs for push notifications after filtering.")
      return
    }

    // Get all tokens for all users
    const tokenPromises = validUserIds.map((userId) => getFcmTokensForUser(userId))
    const tokenArrays = await Promise.all(tokenPromises)
    const fcmTokens = tokenArrays.flat().filter(Boolean) // .flat() and filter out null/undefined

    if (fcmTokens.length === 0) {
      console.warn("No valid FCM tokens found for any of the users.")
      return
    }

    console.log(`Attempting to send push notification to ${fcmTokens.length} devices.`)
    await sendPushNotification(fcmTokens, title, body, data)
    console.log(`Push notification sent for: ${title}`)
  } catch (error) {
    console.error("Error in sendPushNotificationsToUsers:", error)
  }
}

export const uploadFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  const performingUserId = req.user?._id // Get performing user ID

  try {
    if (!req.file) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({ message: "No file uploaded" })
    }

    const { projName, user, financialExecution, physicalExecution, fileName, reference } = req.body

    if (!fileName) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({ message: "Filename is required" })
    }

    if (financialExecution < 0 || financialExecution > 100 || physicalExecution < 0 || physicalExecution > 100) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({ message: "Execution values must be between 0 and 100" })
    }

    const project = await editProject
      .findOne({ projectName: projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session)

    if (!project) {
      await session.abortTransaction() // Abort before ending session
      session.endSession()
      return res.status(404).json({ message: "Project not found" })
    }

    const finalFileName = fileName.includes(".") ? fileName : `${fileName}.${req.file.mimetype.split("/")[1]}`

    // Email notifications (as per your provided code)
    for (const owner of project.projectOwners) {
      const ownerUser = owner.ownerId // Renamed for clarity
      if (ownerUser?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: ownerUser.email,
          subject: `New File Uploaded for Project: ${projName}`,
          html: `<html><body style="font-family: Arial, sans-serif;"><h2 style="color: #333;">New File Uploaded</h2><p>Dear <strong>${ownerUser.userName}</strong>,</p><p>A new file named <strong>"${finalFileName}"</strong> has been uploaded for the project <strong>"${projName}"</strong>.</p><p>Please log in to your dashboard to view or download the file.</p><p style="color: #888;">Best regards,<br>Your Team</p></body></html>`,
        }
        try {
          await SendEmailUtil(emailBody)
          console.log(`Email sent to ${ownerUser.email}`)
        } catch (error) {
          console.error(`Failed to send email to ${ownerUser.email}:`, error.message)
        }
      }
    }

    // --- MODIFIED: Use uploadToS3 ---
    const fileUrl = await uploadToS3(
      req.file.buffer,
      finalFileName, // Use finalFileName which includes extension
      req.file.mimetype,
    )
    if (!fileUrl) {
      await session.abortTransaction()
      session.endSession()
      return res.status(500).json({ message: "File upload to S3 failed" })
    }
    // --- END MODIFICATION ---

    const financeDocument = new FinanceDocument({
      projName,
      fileName: finalFileName,
      fileUrl, // Use the S3 URL
      user, // This should be the ID of the user who is associated with the document if different from uploader
      financialExecution,
      physicalExecution,
      reference,
      uploadedAt: new Date(),
      uploadedBy: performingUserId, // Optionally track who uploaded
    })

    await financeDocument.save({ session })

    // In-app notification recipients
    const inAppNotificationRecipientIds = [
      ...(project.members || []).map((m) => m._id),
      ...(project.projectOwners || []).map((o) => o.ownerId?._id).filter(Boolean),
      performingUserId, // Include the uploader for in-app
    ]
      .filter(Boolean)
      .filter((v, i, a) => a.findIndex((t) => t.toString() === v.toString()) === i)

    const notificationPromises = inAppNotificationRecipientIds.map(
      (userId) =>
        ShowNotification.create(
          [
            {
              // ShowNotification.create expects an array
              title: `New Finance Document Uploaded to the "${finalFileName}"`, // Original title
              type: "Document Upload",
              description: `A New finance document "${finalFileName}" was uploaded for project "${projName}" by ${req.user?.userName || "System"}`, // Added uploader
              lengthyDesc: `We would like to inform you that a New finance document "${finalFileName}" was uploaded for project "${projName}"To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.
//
Best regards,
//
[Soapro Team]
`,
              memberId: userId,
              projectId: project._id,
            },
          ],
          { session },
        ), // Pass session here
    )

    await Promise.all(notificationPromises)
    await session.commitTransaction() // Commit before sending push notifications

    // --- PUSH NOTIFICATION LOGIC (after commit) ---
    const pushNotificationRecipientIds = [...inAppNotificationRecipientIds] // Can be the same or different
    await sendPushNotificationsToUsers(
      pushNotificationRecipientIds,
      "New Finance Document Uploaded",
      `File "${finalFileName}" for project "${projName}" was uploaded by ${req.user?.userName || "System"}.`,
      {
        type: "Finance Document Uploaded",
        projectId: project._id.toString(),
        documentId: financeDocument._id.toString(),
        documentName: finalFileName,
      },
    )
    // --- END PUSH NOTIFICATION LOGIC ---

    res.status(201).json({
      message: "File uploaded successfully!",
      financeDocument,
    })
  } catch (error) {
    await session.abortTransaction() // Ensure abort on error
    console.error("Error uploading file:", error.message, error.stack)
    res.status(500).json({
      message: "Error uploading file",
      error: error.message,
    })
  } finally {
    if (session.inTransaction()) {
      // End session only if it's still active
      await session.abortTransaction() // Abort if not committed
    }
    session.endSession()
  }
}

export const getFinanceDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user

    const assignedProjects = await editProject.find({
      ...(!isMain ? { $or: [{ members: loggedInUserId }, { "projectOwners.ownerId": loggedInUserId }] } : {}),
    })

    const projectNames = assignedProjects.map((proj) => proj.projectName)

    if (projectNames.length === 0 && !isMain) {
      // If not admin and no projects, return empty
      return res.status(200).json([]) // Return empty array for consistency
    }
    if (projectNames.length === 0 && isMain) {
      // If admin and no projects at all, return empty
      return res.status(200).json([])
    }

    const financeDocuments = await FinanceDocument.find(
      isMain && projectNames.length === 0 ? {} : { projName: { $in: projectNames } }, // If admin and no specific project names, fetch all
    ).sort({ uploadedAt: -1 })

    res.status(200).json(financeDocuments)
  } catch (error) {
    console.error("Error fetching finance documents:", error.message)
    res.status(500).json({
      message: "Failed to fetch finance documents",
      error: error.message,
    })
  }
}

export const updateFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  const performingUserId = req.user?._id

  try {
    const { id } = req.params
    const updates = {}
    let changesMade = false

    const existingDocument = await FinanceDocument.findById(id).session(session)
    if (!existingDocument) {
      await session.abortTransaction()
      session.endSession()
      return res.status(404).json({ message: "Document not found" })
    }

    // Get current values to preserve them if not explicitly updated
    let newFinancialExecution = existingDocument.financialExecution
    let newPhysicalExecution = existingDocument.physicalExecution

    // Update financial execution if provided
    if (Object.prototype.hasOwnProperty.call(req.body, "financialExecution")) {
      const finExec = Number.parseFloat(req.body.financialExecution)
      if (isNaN(finExec) || finExec < 0 || finExec > 100) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({
          message: "Financial Execution must be a number between 0 and 100",
        })
      }
      if (existingDocument.financialExecution !== finExec) {
        newFinancialExecution = finExec
        changesMade = true
      }
    }

    // Update physical execution if provided
    if (Object.prototype.hasOwnProperty.call(req.body, "physicalExecution")) {
      const phyExec = Number.parseFloat(req.body.physicalExecution)
      if (isNaN(phyExec) || phyExec < 0 || phyExec > 100) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({
          message: "Physical Execution must be a number between 0 and 100",
        })
      }
      if (existingDocument.physicalExecution !== phyExec) {
        newPhysicalExecution = phyExec
        changesMade = true
      }
    }

    // Always include both values in updates
    updates.financialExecution = newFinancialExecution
    updates.physicalExecution = newPhysicalExecution

    if (req.body.fileName && typeof req.body.fileName === "string" && req.body.fileName.trim() !== "") {
      if (existingDocument.fileName !== req.body.fileName.trim()) {
        updates.fileName = req.body.fileName.trim()
        changesMade = true
      }
    }

    if (req.body.reference && typeof req.body.reference === "string") {
      if (existingDocument.reference !== req.body.reference) {
        updates.reference = req.body.reference
        changesMade = true
      }
    }

    if (changesMade) {
      updates.uploadedAt = new Date()
    } else {
      await session.abortTransaction()
      session.endSession()
      return res.status(200).json({
        message: "No substantive changes detected. Document not updated.",
        document: existingDocument,
      })
    }

    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true, session },
    )

    if (!updatedFinanceDocument) {
      await session.abortTransaction()
      session.endSession()
      throw new ApiError(500, "Failed to update document after finding it.")
    }

    const project = await editProject
      .findOne({ projectName: existingDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session)

    const inAppNotificationData = {
      title: "Finance Document Updated",
      type: "Document Update",
      description: `Document "${updatedFinanceDocument.fileName}" for project "${project?.projectName || existingDocument.projName}" was updated by ${req.user?.userName || "System"}.`,
      memberId: performingUserId,
      projectId: project?._id,
    }

    if (mongoose.Types.ObjectId.isValid(performingUserId)) {
      await ShowNotification.create([inAppNotificationData], { session })
    }

    await session.commitTransaction()

    const pushNotificationRecipientIds = []
    if (project) {
      project.projectOwners?.forEach((o) => {
        if (o.ownerId?._id) pushNotificationRecipientIds.push(o.ownerId._id)
      })
      project.members?.forEach((m) => {
        if (m?._id) pushNotificationRecipientIds.push(m._id)
      })
    }

    if (performingUserId && !pushNotificationRecipientIds.some((id) => id.equals(performingUserId))) {
      pushNotificationRecipientIds.push(performingUserId)
    }

    const uniquePushRecipients = [...new Set(pushNotificationRecipientIds.map((id) => id.toString()))]

    await sendPushNotificationsToUsers(
      uniquePushRecipients,
      "Finance Document Updated",
      `Document "${updatedFinanceDocument.fileName}" in project "${project?.projectName || existingDocument.projName}" was updated by ${req.user?.userName || "System"}.`,
      {
        type: "Finance Document Updated",
        projectId: project?._id.toString() || "",
        documentId: updatedFinanceDocument._id.toString(),
        documentName: updatedFinanceDocument.fileName,
      },
    )

    const ownerEmails = project?.projectOwners?.map((owner) => owner.ownerId?.email).filter(Boolean) || []
    const memberEmails = project?.members?.map((member) => member?.email).filter(Boolean) || []

    let performingUserEmail = null
    if (performingUserId) {
      const pUser = await User.findById(performingUserId).select("email").lean()
      performingUserEmail = pUser?.email
    }

    const allEmailRecipients = [
      ...new Set([...ownerEmails, ...memberEmails, ...(performingUserEmail ? [performingUserEmail] : [])]),
    ]

    if (allEmailRecipients.length > 0) {
      const emailBody = {
        from: process.env.EMAIL_USER,
        to: allEmailRecipients.join(","),
        subject: `Finance Document Updated for Project: ${project?.projectName || existingDocument.projName}`,
        html: `<html><body style="font-family: Arial, sans-serif;">
                 <h2 style="color: #333;">Finance Document Updated</h2>
                 <p>Hello,</p>
                 <p>The finance document "<strong>${updatedFinanceDocument.fileName}</strong>" for the project "<strong>${project?.projectName || existingDocument.projName}</strong>" has been updated by ${req.user?.userName || "System"}.</p>
                 <p>You can view the updated document by logging into the platform.</p>
                 <p style="color: #888;">Best regards,<br>Your Team</p>
               </body></html>`,
      }
      try {
        await SendEmailUtil(emailBody)
        console.log(`📨 Email sent to: ${allEmailRecipients.join(", ")}`)
      } catch (error) {
        console.error("❌ Failed to send email:", error.message)
      }
    }

    res.status(200).json({
      message: "Document updated, notifications and emails sent successfully.",
      document: updatedFinanceDocument,
    })
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction()
    console.error("Error updating document:", error)
    res.status(error.statusCode || 500).json({
      message: error.message || "Error updating document",
    })
  } finally {
    session.endSession()
  }
}

export const deleteFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  const performingUserId = req.user?._id

  try {
    const financeDocument = await FinanceDocument.findById(req.params.id).session(session)
    if (!financeDocument) {
      await session.abortTransaction()
      session.endSession()
      return res.status(404).json({ message: "Document not found" })
    }

    const project = await editProject
      .findOne({ projectName: financeDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session)

    // --- S3 Deletion (use deleteFromS3) ---
    if (financeDocument.fileUrl) {
      // Check if fileUrl exists
      try {
        // Assuming fileUrl is the full S3 URL. Extract the key.
        // Example: https://bucket-name.s3.amazonaws.com/file-key
        const urlParts = financeDocument.fileUrl.split("/")
        const fileKey = urlParts.slice(3).join("/") // Get everything after bucket name
        if (fileKey) {
          await deleteFromS3(fileKey)
          console.log(`Deleted ${fileKey} from S3.`)
        } else {
          console.warn(`Could not extract file key from URL: ${financeDocument.fileUrl} for S3 deletion.`)
        }
      } catch (s3Error) {
        console.error("Error deleting file from S3:", s3Error.message)
        // Decide if this should be a critical error. For now, we'll proceed with DB deletion.
      }
    }
    // --- END S3 Deletion ---

    await FinanceDocument.findByIdAndDelete(req.params.id, { session })

    // In-app notification recipients
    const inAppNotificationRecipientIds = []
    if (project) {
      project.projectOwners?.forEach((o) => {
        if (o.ownerId?._id) inAppNotificationRecipientIds.push(o.ownerId._id)
      })
      project.members?.forEach((m) => {
        if (m?._id) inAppNotificationRecipientIds.push(m._id)
      })
    }
    if (performingUserId) inAppNotificationRecipientIds.push(performingUserId)
    const uniqueInAppRecipients = [...new Set(inAppNotificationRecipientIds.map((id) => id.toString()))]

    const notificationPromises = uniqueInAppRecipients.map(
      (userIdStr) =>
        ShowNotification.create(
          [
            {
              // ShowNotification.create expects an array
              title: `New Finance Document Deleted "${financeDocument.fileName}"`, // Original title
              type: "Document Deletion",
              description: `A new Document "${financeDocument.fileName}" was deleted from project"${financeDocument.projName}" by ${req.user?.userName || "System"}`,
              lengthyDesc: `We would like to inform you that a new Document "${financeDocument.fileName}" was deleted from project"${financeDocument.projName}"To view or download the document, please access the project's section on the platform.Should you have any questions or require assistance, our team remains at your disposal.
//
Best regards,
//
[Soapro Team]
`,
              memberId: new mongoose.Types.ObjectId(userIdStr),
              projectId: project?._id,
            },
          ],
          { session },
        ), // Pass session here
    )
    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises)
    }

    await session.commitTransaction() // Commit before sending external notifications

    // Push Notification (using the same recipients as in-app for consistency here)
    await sendPushNotificationsToUsers(
      uniqueInAppRecipients, // Send to the same people who got in-app
      "Finance Document Deleted",
      `Document "${financeDocument.fileName}" from project "${project?.projectName || financeDocument.projName}" was deleted by ${req.user?.userName || "System"}.`,
      {
        type: "Finance Document Deleted",
        projectId: project?._id.toString() || "",
        documentName: financeDocument.fileName,
        deletedDocumentId: financeDocument._id.toString(),
      },
    )

    // Email notifications (as per your provided code)
    if (project) {
      for (const owner of project.projectOwners) {
        if (owner.ownerId?.email) {
          const emailBody = {
            from: process.env.EMAIL_USER,
            to: owner.ownerId.email,
            subject: `Finance Document Deleted for Project: ${project.projectName}`,
            html: `<p>Dear ${owner.ownerId.userName || "Owner"}, document "${financeDocument.fileName}" deleted by ${req.user?.userName || "System"}.</p>`,
          }
          try {
            await SendEmailUtil(emailBody)
          } catch (e) {
            console.error(`Email error to owner ${owner.ownerId.email}:`, e.message)
          }
        }
      }
      for (const member of project.members) {
        if (member?.email) {
          const emailBody = {
            from: process.env.EMAIL_USER,
            to: member.email,
            subject: `Finance Document Deleted for Project: ${project.projectName}`,
            html: `<p>Dear ${member.userName || "Member"}, document "${financeDocument.fileName}" deleted by ${req.user?.userName || "System"}.</p>`,
          }
          try {
            await SendEmailUtil(emailBody)
          } catch (e) {
            console.error(`Email error to member ${member.email}:`, e.message)
          }
        }
      }
    }

    res.status(200).json({ message: "Document deleted and notifications sent!" })
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction()
    console.error("Error deleting document:", error.message, error.stack)
    res.status(500).json({ message: "Error deleting document", error: error.message })
  } finally {
    session.endSession()
  }
}

// export {
//   uploadFinanceDocument,
//   getFinanceDocuments,
//   updateFinanceDocument,
//   deleteFinanceDocument,
// };
