import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";


const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(`mongodb+srv://Construction:kgHtlJmT4UYEaGkB@cluster0.0k3vc.mongodb.net/`)
        console.log(`\n 🚀 ~MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("❌ MONGODB connection FAILED ", error);
        process.exit(1)
    }
}

export default connectDB