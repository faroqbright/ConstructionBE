import multer from "multer";

const fileSizeLimit = 150 * 1024 * 1024;

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: fileSizeLimit,
  },
});

export default upload;