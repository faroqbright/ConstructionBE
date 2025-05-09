import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";


const updateOrCreateLanguagePreference = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { languageSelected } = req.body;


  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format");
  }


  if (
    !languageSelected ||
    typeof languageSelected !== "string" ||
    languageSelected.trim() === ""
  ) {
    throw new ApiError(
      400,
      "languageSelected is required and must be a non-empty string"
    );
  }

  const preference = await LanguagePreference.findOneAndUpdate(
    { userId: userId }, 
    {
      $set: {
        userId: userId, 
        languageSelected: languageSelected.trim(),
      },
    },
    {
      new: true,
      upsert: true, 
      runValidators: true,
    }
  );

  if (!preference) {
    throw new ApiError(
      500,
      "Something went wrong while updating or creating the language preference"
    );
  }

  return res
    .status(200) 
    .json(
      new ApiResponse(
        200,
        preference,
        "Language preference updated/created successfully"
      )
    );
});

export { updateOrCreateLanguagePreference };