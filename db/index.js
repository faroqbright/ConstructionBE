import mongoose from "mongoose";

const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(
            `mongodb+srv://AppSoapro:admin123@constructionproductionc.myejhgy.mongodb.net/`
        );
        console.log(`\n 🚀 ~ MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("❌ MONGODB connection FAILED ", error);
        process.exit(1);
    }
};

export default connectDB;
