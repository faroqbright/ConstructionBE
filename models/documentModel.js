import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
    projName: { type: String, required: false }, // Required for admin
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true }, // Store file size in bytes
    fileUrl: { type: String, required: true },
    user: { type: String, required: true }, // Store user ID or name
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Document', documentSchema);
