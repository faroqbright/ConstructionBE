import mongoose from 'mongoose';

const financeDocumentSchema = new mongoose.Schema({
    projName: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    user: { type: String, required: true },
    financialExecution: { type: Number, required: true, min: 0, max: 100 },
    physicalExecution: { type: Number, required: true, min: 0, max: 100 },
    uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('FinanceDocument', financeDocumentSchema);
