import multer from "multer";

const storage = multer.memoryStorage(); // Store files in memory before upload
const upload = multer({ storage });

export default upload;
