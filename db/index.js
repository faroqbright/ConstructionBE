import mongoose from "mongoose";

const connectDB = async () => {
  try {
    // const connectionInstance = await mongoose.connect(
    //   `mongodb+srv://AppSoapro:admin123@constructionproductionc.myejhgy.mongodb.net/`
    // );
    const connectionInstance = await mongoose.connect(
      `mongodb://AppSoapro:admin123@ac-atf7rht-shard-00-00.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-01.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-02.myejhgy.mongodb.net:27017/?ssl=true&replicaSet=atlas-h0q9dd-shard-0&authSource=admin&appName=ConstructionProductionCluster`
    );
    // const connectionInstance = await mongoose.connect(
    //   `mongodb://junaidalvi589_db_user:87654321@ac-thbagms-shard-00-00.jbvhawf.mongodb.net:27017,ac-thbagms-shard-00-01.jbvhawf.mongodb.net:27017,ac-thbagms-shard-00-02.jbvhawf.mongodb.net:27017/?ssl=true&replicaSet=atlas-jcavo2-shard-0&authSource=admin&appName=Cluster0`
    // );
    console.log(
      `\n 🚀 ~ MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.log("❌ MONGODB connection FAILED ", error);
    process.exit(1);
  }
};

export default connectDB;
