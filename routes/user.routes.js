import { Router } from 'express';
import { 
    registerUser, 
    verifyOTP, 
    resendOTP, 
    getUserProfile, 
    login, 
    forgetPassword, 
    resetPassword, 
    logoutUser, 
    updateProfile, 
    refreshAccessToken,
    updatePassword
} from '../controllers/user.controller.js';
import { upload } from '../middlewares/multer.middleware.js'; 
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { errorHandler } from "../utils/errorHandler.js";

const router = Router();

router.route('/register').post(registerUser);
router.route('/login').post(login);
router.route("/profile").get(verifyJWT, getUserProfile);

router.route('/forget-password').post(forgetPassword);
router.route('/verify-otp').post(verifyOTP);
router.route('/resend-otp').post(resendOTP);
router.route('/reset-password').post(resetPassword);
router.route("/logout").post(verifyJWT, logoutUser);
router.route("/update-password").post(verifyJWT, updatePassword);

// --- FIX IS HERE ---
// Apply the upload middleware specifically for the avatar field
router.route("/update-profile/:userId").put(
    verifyJWT, 
    upload.fields([{ name: 'avatar', maxCount: 1 }]), 
    updateProfile 
);
// --------------------

router.route("/refresh-token").post(refreshAccessToken);
router.use(errorHandler); 

export default router;