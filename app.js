import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
const app = express()

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}))

app.use(express.json({limit: "50mb"}))
app.use(express.urlencoded({extended: true, limit: "50mb"}))
app.use(express.static("public"))
app.use(cookieParser())


import userRouter from './routes/user.routes.js'
import notificationsRouter from './routes/notifications.routes.js'
import projectRouter from './routes/project.routes.js'
import teamMemberRouter from './routes/teamMember.routes.js'
import documentRoutes from './routes/documentRoutes.js'
import userdocumentRoutes from './routes/userdocumentRoutes.js'
import companiesRoutes from './routes/company.routes.js'
import rolesRouter from './routes/roles.routes.js'
import rolesUserRouter from './routes/rolesUser.routes.js'
import clientsRouter from './routes/clients.routes.js'
import financeRoutes from './routes/finance.routes.js'
import { ApiError } from "./utils/ApiError.js"


app.use("/api/v1/clients", clientsRouter)
app.use("/api/v1/rolesUser", rolesUserRouter)
app.use("/api/v1/roles", rolesRouter)
app.use("/api/v1/users", userRouter)
app.use("/api/v1/notifications", notificationsRouter)
app.use("/api/v1/projects", projectRouter)
app.use("/api/v1/teamMember", teamMemberRouter)
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/userdocuments', userdocumentRoutes);
app.use('/api/v1/companies', companiesRoutes);
app.use('/api/v1/finance', financeRoutes);

app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({
        statusCode: err.statusCode,
        data: err.data,
        message: err.message,
        success: err.success,
        errors: err.errors,
      });
    }
  
    // Handle other types of errors (optional)
    return res.status(500).json({
      statusCode: 500,
      data: null,
      message: "Internal Server Error",
      success: false,
      errors: [],
    });
  });
export { app }