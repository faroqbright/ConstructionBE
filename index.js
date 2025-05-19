import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config({
  path: "./.env",
});

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {

  socket.on("customEvent", (data) => {
    io.emit("updateEvent", { message: "Update triggered" });
  });
});

connectDB()
  .then(() => {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
      console.log(`⚙️ Server is running at port: ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MONGO DB connection failed:", err);
  });

export { io };