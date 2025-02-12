import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config({
  path: "./.env",
});

// Create HTTP server for Socket.IO
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("New client connected");

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });

  // Custom events (example)
  socket.on("customEvent", (data) => {
    console.log("Custom event received:", data);
    // Broadcast to all connected clients
    io.emit("updateEvent", { message: "Update triggered" });
  });
});

// Connect to MongoDB and start the server
connectDB()
  .then(() => {
    const PORT = process.env.PORT || 8000;
    server.listen(PORT, () => {
      console.log(`⚙️ Server is running at port: ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MONGO DB connection failed:", err);
  });

export { io };

// import dotenv from "dotenv"
// import connectDB from "./db/index.js";
// import {app} from './app.js'
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// dotenv.config({
//     path: './.env'
// })

// const server = createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:5173", // Replace with your frontend URL
//     methods: ["GET", "POST"]
//   }
// });

// io.on('connection', (socket) => {
//   console.log('New client connected');

//   socket.on('disconnect', () => {
//     console.log('Client disconnected');
//   });
// });

// connectDB()
// .then(() => {
//     app.listen(process.env.PORT || 8000, () => {
//         console.log(`⚙️ Server is running at port : ${process.env.PORT}`);
//     })
// })
// .catch((err) => {
//     console.log("MONGO db connection failed !!! ", err);
// })
// export { io };