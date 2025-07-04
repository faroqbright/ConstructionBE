import mongoose from 'mongoose';

const financeDocumentSchema = new mongoose.Schema({
     projectOwners: [
          {
            ownerId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User", // <- this MUST match the model name you're populating
            },
            ownerName: String,
          }
        ],
          members: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
              },
            ],
    projName: { type: String, required: true },
    fileName: { type: String, required: false },
    reference: { type: String, required: true },
    fileUrl: { type: String, required: true },
    user: { type: String, required: true },
    financialExecution: { type: Number, required: false, min: 0, max: 100 },
    physicalExecution: { type: Number, required: false, min: 0, max: 100 },
    uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('FinanceDocument', financeDocumentSchema);
