import mongoose from 'mongoose';

const userdocumentSchema = new mongoose.Schema({
    projName: { type: String, required: false }, // Required for admin
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    user: { type: String, required: true }, // Store user ID or name
    uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('UserDocument', userdocumentSchema);
