// Check notification settings and token for jawad test user
import mongoose from 'mongoose';
import { NotificationSetting } from './models/notificationSetting.model.js';
import { LanguagePreference } from './models/languagePreferenceSchema.js';
import { User } from './models/user.model.js';

const userId = '69f8688c81791672e6617d8b'; // jawad test user

const MONGODB_URI = 'mongodb://AppSoapro:admin123@ac-atf7rht-shard-00-00.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-01.myejhgy.mongodb.net:27017,ac-atf7rht-shard-00-02.myejhgy.mongodb.net:27017/?ssl=true&replicaSet=atlas-h0q9dd-shard-0&authSource=admin&appName=ConstructionProductionCluster';

async function checkUser() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Check user details
    const user = await User.findById(userId);
    console.log('=== USER DETAILS ===');
    console.log('Name:', user?.userName);
    console.log('Email:', user?.email);
    console.log('FCM Token:', user?.fcmDeviceToken || 'NULL');
    console.log('Notification Token:', user?.notificationToken || 'NULL');
    console.log('');

    // Check notification setting
    const setting = await NotificationSetting.findOne({ userId });
    console.log('=== NOTIFICATION SETTING ===');
    if (setting) {
      console.log('Status:', setting.status);
      console.log('Created:', setting.createdAt);
    } else {
      console.log('No notification setting found - notifications ENABLED by default');
    }
    console.log('');

    // Check language preference
    const langPref = await LanguagePreference.findOne({ userId });
    console.log('=== LANGUAGE PREFERENCE ===');
    if (langPref) {
      console.log('Language:', langPref.languageSelected);
    } else {
      console.log('No language preference found - defaults to Portuguese');
    }
    console.log('');

    await mongoose.disconnect();
    console.log('Done!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUser();
