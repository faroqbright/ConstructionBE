// ../utils/firebase.service.js
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { NotificationSetting } from "../models/notificationSetting.model.js"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, 'construct-flow-50bcd638645c.json');

let initialized = false;

async function initializeFirebaseAdmin() {
  if (!initialized) {
    try {
      const serviceAccountString = await readFile(serviceAccountPath, 'utf8');
      const serviceAccount = JSON.parse(serviceAccountString);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin SDK initialized successfully.');
      initialized = true;
    } catch (error) {
      console.error('Error initializing Firebase Admin SDK:', error);
    }
  }
}

initializeFirebaseAdmin();

export const sendNotification = async (userId, tokens, title, body, data = {}) => {

  if (!initialized) {
    console.error('Firebase Admin SDK not initialized. Cannot send notification.');
    return;
  }

  try {
    // Check if the user has notifications enabled
    const setting = await NotificationSetting.findOne({ userId });

    if (!setting || setting.status === false) {
      console.log(`Notifications are disabled for user ${userId}`);
      return;
    }

    if (!tokens || tokens.length === 0) {
      console.log('No tokens provided for notification');
      return;
    }

    const validTokens = tokens.filter(token => token && typeof token === 'string' && token.trim() !== '');

    if (validTokens.length === 0) {
      console.log('No valid tokens available for notification');
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    const failedTokens = [];

    for (const token of validTokens) {
      try {
        const message = {
          notification: {
            title,
            body,
          },
          data: {
            ...data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          token,
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent message to ${token}:`, response);
        successCount++;
      } catch (err) {
        console.error(`Failed to send to token ${token}:`, err.message);
        if (err.errorInfo) {
          console.error('Error Info:', JSON.stringify(err.errorInfo, null, 2));
        }
        failedTokens.push(token);
        failureCount++;
      }
    }

    console.log(`Notification send complete: ${successCount} successes, ${failureCount} failures.`);
    if (failedTokens.length > 0) {
      console.log('List of tokens that failed:', failedTokens);
    }

    return { successCount, failureCount, failedTokens };
  } catch (error) {
    console.error('Error sending notification via Firebase:', error);
  }
  return { successCount: 0, failureCount: 0, failedTokens: [] };
};