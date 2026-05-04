// Test script to insert notification settings for testing
import mongoose from 'mongoose';
import { NotificationSetting } from './models/notificationSetting.model.js';

const testUserId = '69f60901d0276171aa24b5ca'; // Member user from logs

const MONGODB_URI = 'mongodb://AppSoapro:admin123@ac-atf7rht-shard-00-00.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-01.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-02.myejhgy.mongodb.net:27017/?ssl=true&replicaSet=atlas-h0q9dd-shard-0&authSource=admin&appName=ConstructionProductionCluster';

async function insertTestData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if setting already exists
    const existing = await NotificationSetting.findOne({ userId: testUserId });
    
    if (existing) {
      console.log('Setting already exists:', existing);
      // Toggle it to false for testing
      existing.status = false;
      await existing.save();
      console.log('Updated to disabled (status: false)');
    } else {
      // Create new disabled setting
      const setting = await NotificationSetting.create({
        userId: testUserId,
        status: false
      });
      console.log('Created disabled notification setting:', setting);
    }

    // Verify all settings
    const allSettings = await NotificationSetting.find();
    console.log('\nAll notification settings:', allSettings);

    await mongoose.disconnect();
    console.log('\nTest data ready! Now trigger a project update and check logs for:');
    console.log(`"[editProjects] Skipping user ${testUserId} - notifications disabled"`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

insertTestData();
