import { AdditionalMilestone } from "../models/additionalMilestone.js";

// CREATE or UPDATE if exists
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

// READ ALL milestones for a project
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

// READ single milestone by ID
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

// UPDATE milestone by ID
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

// DELETE milestone by ID
export const deleteMilestone = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await AdditionalMilestone.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    res.status(200).json({
      success: true,
      message: "Milestone deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteMilestone:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
