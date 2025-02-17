import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";


const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(`mongodb+srv://razorsgamer2005:admin123@cluster0.epy2w.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`)
        console.log(`\n 🚀 ~MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("❌ MONGODB connection FAILED ", error);
        process.exit(1)
    }
}

export default connectDB