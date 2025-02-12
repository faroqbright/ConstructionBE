import multer from 'multer';

const storage = multer.memoryStorage();  // Use memory storage for direct upload to S3

export const upload = multer({ storage });
