import { BusinessArea } from "../models/businessAreasModal.js";

// Create or Update Business Area
export const createOrUpdateBusinessArea = async (req, res) => {
  const { businessArea, role } = req.body;

  try {
    if (!businessArea) {
      return res.status(400).json({ success: false, message: "Business Area is required" });
    }

    const existing = await BusinessArea.findOne({ businessArea });

    if (existing) {
      await existing.save();

      return res.status(200).json({
        success: true,
        message: "Business Area updated successfully",
        data: existing,
      });
    }

    const newBusinessArea = await BusinessArea.create({
      businessArea,
      role
    });

    res.status(201).json({
      success: true,
      message: "Business Area created successfully",
      data: newBusinessArea,
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

  try {
    const deleted = await BusinessArea.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Business Area not found" });
    }

    res.status(200).json({ success: true, message: "Business Area deleted successfully" });
  } catch (error) {
    console.error("Error in deleteBusinessArea:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
