
import { Router } from 'express';
import { createProject, deleteProject, editProjects, getAllProjects, getProjectById } from '../controllers/editProject.controller.js';
import { errorHandler } from "../utils/errorHandler.js";
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { upload } from '../middlewares/multer.middleware.js';

const router = Router();


router.route('/')
    .post(verifyJWT, upload.fields([
        {
            name: "projectBanner",
            maxCount: 3,
        }
    ]), createProject)
    .get(verifyJWT, getAllProjects);

router.route('/:projectId')
    .get(verifyJWT, getProjectById)
    .put(verifyJWT, upload.fields([
        {
            name: "projectBanner",
            maxCount: 3,
        }
    ]), editProjects)
    .delete(verifyJWT, deleteProject);




router.use(errorHandler);


export default router;
