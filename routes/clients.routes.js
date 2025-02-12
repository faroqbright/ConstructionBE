import express from "express";
import { createClient, getAllClients, getClientById,  deleteClientById, editClient } from "../controllers/Clients.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Routes for roleUser
router.route('/')
    .post(verifyJWT, createClient)
    .get(verifyJWT, getAllClients);

router.route('/:id')
    .get(verifyJWT, getClientById)
    .patch(verifyJWT, editClient)
    .delete(verifyJWT, deleteClientById);

export default router;
