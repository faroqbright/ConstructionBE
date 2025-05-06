import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import jwt from "jsonwebtoken"
import { User } from "../models/user.model.js"
import { BusinessArea } from "../models/businessAreasModal.js" // Add this import

export const verifyJWT = asyncHandler(async (req, _, next) => {
  try {
    const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "")

    if (!token) {
      throw new ApiError(401, "Unauthorized request")
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

    // Populate the role to get role._id for business area lookup
    const user = await User.findById(decodedToken?._id).select("-password -refreshToken").populate("role")

    if (!user) {
      throw new ApiError(401, "Invalid Access Token")
    }

    // Fetch assigned business areas if user has a role
    if (user.role && user.role._id) {
      const assignedBusinessAreas = await BusinessArea.find({
        role: user.role._id,
      }).select("businessArea")

      // Attach to user object so it's available in req.user
      user.assignedBusinessAreas = assignedBusinessAreas || []
    } else {
      user.assignedBusinessAreas = []
    }

    req.user = user
    next()
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid access token")
  }
})
