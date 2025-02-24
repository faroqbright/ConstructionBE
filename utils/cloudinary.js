import { v2 as cloudinary } from "cloudinary"
import fs from "fs"
import dotenv from "dotenv";
dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto"
        })
        fs.unlinkSync(localFilePath)
        return response;

    } catch (error) {
        fs.unlinkSync(localFilePath)
        return null;
    }
}

/**
 * Upload a file to S3
 * @param {object} file - File object from multer or similar library
 * @returns {Promise<{fileName: string, url: string}>} Uploaded file information
 */

import AWS from 'aws-sdk';

const s3 = new AWS.S3({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const uploadToS3 = async (fileBuffer, fileName, mimeType) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `avatars/${fileName}`,
        Body: fileBuffer,
        ContentType: mimeType,
        // Remove the ACL parameter if your bucket doesn't allow ACLs
    };

    try {
        const uploadResult = await s3.upload(params).promise();
        return uploadResult.Location;
    } catch (error) {
        console.error("Error uploading to S3:", error);
        return null;
    }
};

// const uploadToS3 = async (fileBuffer, fileName, mimeType) => {
//     const params = {
//         Bucket: process.env.AWS_S3_BUCKET_NAME,
//         Key: `avatars/${fileName}`,
//         Body: fileBuffer,
//         ContentType: mimeType,
//         ACL: 'public-read',
//     };

//     try {
//         const uploadResult = await s3.upload(params).promise();
//         return uploadResult.Location;
//     } catch (error) {
//         console.error("Error uploading to S3:", error);
//         return null;
//     }
// };

export { uploadOnCloudinary, uploadToS3 }
