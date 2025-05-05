import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { ShowNotification } from "../models/showNotificationSchema.js";

export const createOrUpdateMilestone = async (req, res) => {
  const { id: projectId } = req.params;
  const { title, description, status, completedAt, userId } = req.body;

  try {
    const existingMilestone = await AdditionalMilestone.findOne({ title, projectId });

    if (existingMilestone) {
      if (description) existingMilestone.description = description;
      if (status) existingMilestone.status = status;
      if (completedAt) existingMilestone.completedAt = completedAt;
      if (userId) existingMilestone.userId = userId;

      await existingMilestone.save();

      // Create notification for milestone update
      await ShowNotification.create({
        title: "Milestone Updated",
        type: "Milestone Update",
        description: `Milestone "${title}" has been updated`,
        memberId: userId,
        projectId: projectId,
      });

      return res.status(200).json({
        success: true,
        message: "Milestone updated successfully",
        data: existingMilestone,
      });
    }

    const newMilestone = await AdditionalMilestone.create({
      title,
      description,
      status,
      completedAt,
      userId,
      projectId,
    });

    // Create notification for new milestone
    await ShowNotification.create({
      title: "New Milestone Created",
      type: "Milestone Creation",
      description: `New milestone "${title}" has been created`,
      memberId: userId,
      projectId: projectId,
    });

    res.status(201).json({
      success: true,
      message: "Milestone created successfully",
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
    const milestones = await AdditionalMilestone.find({ projectId }).sort({ createdAt: -1 });
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
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    res.status(200).json({ success: true, data: milestone });
  } catch (error) {
    console.error("Error in getSingleMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateMilestone = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const updatedMilestone = await AdditionalMilestone.findByIdAndUpdate(
      id,
      updates,
      { new: true }
    );

    if (!updatedMilestone) {
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    // Create notification for milestone update
    await ShowNotification.create({
      title: "Milestone Updated",
      type: "Milestone Update",
      description: `Milestone "${updatedMilestone.title}" has been updated`,
      memberId: updatedMilestone.userId,
      projectId: updatedMilestone.projectId,
    });

    res.status(200).json({
      success: true,
      message: "Milestone updated successfully",
      data: updatedMilestone,
    });
  } catch (error) {
    console.error("Error in updateMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteMilestone = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await AdditionalMilestone.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    // Create notification for milestone deletion
    await ShowNotification.create({
      title: "Milestone Deleted",
      type: "Milestone Deletion",
      description: `Milestone "${deleted.title}" has been deleted`,
      memberId: deleted.userId,
      projectId: deleted.projectId,
    });

    res.status(200).json({
      success: true,
      message: "Milestone deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getUserMilestones = async (req, res) => {
  const { id: userId } = req.params;

  try {
    const milestones = await AdditionalMilestone.find({ userId }).sort({ createdAt: -1 });

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