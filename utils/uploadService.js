import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

// Initialize AWS S3 Client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a file to S3
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - Name for the file
 * @param {string} mimeType - File MIME type
 * @returns {Promise<string>} - File URL after upload
 */
const uploadToS3 = async (fileBuffer, fileName, mimeType) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `uploads/${fileName}`,
        Body: fileBuffer,
        ContentType: mimeType,
    };

    try {
        console.log(`Uploading ${fileName} to S3...`);
        const response = await s3.send(new PutObjectCommand(params));
        console.log(`Upload successful: ${fileName}`, response);
        
        return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${fileName}`;
    } catch (error) {
        console.error("AWS S3 Upload Error:", error);
        throw new Error(`File upload failed: ${error.message}`);
    }
};

const deleteFromS3 = async (fileKey) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileKey,
  };

  try {
    await s3.deleteObject(params).promise();
    console.log(`File deleted from S3: ${fileKey}`);
  } catch (error) {
    console.error("Error deleting from S3:", error);
  }
};

export { uploadToS3, deleteFromS3 };
