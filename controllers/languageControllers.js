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

/**
 * @description Get language preference for a user by their ID. Creates default if not found.
 * @route GET /api/v1/language/users/:userId (or /api/v1/users/:userId/language)
 * @access Private
 */
const getLanguagePreferenceByUserId = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const requestingUser = req.user; // Assuming verifyJWT populates req.user
  
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(400, "Invalid User ID format.");
    }
  
    // Optional Authorization: Check if the logged-in user can access this preference
    // Example: User can only get their own preference, or an admin can get any.
    // if (requestingUser._id.toString() !== userId && !requestingUser.isAdmin) { // Assuming isAdmin field
    //   throw new ApiError(403, "You are not authorized to access this language preference.");
    // }
  
    let preference = await LanguagePreference.findOne({ userId: userId });
  
    if (!preference) {
      // If no preference exists, create one with the default language from the schema
      // This ensures the frontend always receives a preference object.
      try {
        preference = await LanguagePreference.create({ userId: userId }); // Schema default for languageSelected will be used
                                                                       // which is "portuguese" in your schema.
      } catch (error) {
          // Handle potential unique constraint violation if another request creates it simultaneously (rare)
          if (error.code === 11000) { // Duplicate key error
              preference = await LanguagePreference.findOne({ userId: userId });
              if (!preference) { // If still not found after a duplicate error, something is very wrong
                  throw new ApiError(500, "Failed to retrieve or initialize language preference after race condition.");
              }
          } else {
              console.error("Error creating default language preference:", error);
              throw new ApiError(500, "Failed to initialize language preference for the user.");
          }
      }
    }
  
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          preference,
          "Language preference fetched successfully."
        )
      );
  });
  
  export { updateOrCreateLanguagePreference, getLanguagePreferenceByUserId };