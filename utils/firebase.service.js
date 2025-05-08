import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let initialized = false;

async function initializeFirebaseAdmin() {
  if (!initialized) {
    try {
      const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;

      if (!serviceAccountString) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is missing.');
      }

      const serviceAccount = JSON.parse(serviceAccountString);

      // Fix escaped newlines in private_key
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

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

// Export your existing notification function below
export const sendNotification = async (tokens, title, body, data = {}) => {
  if (!initialized) {
    console.error('Firebase Admin SDK not initialized. Cannot send notification.');
    return;
  }

  try {
    const validTokens = (tokens || []).filter(token => token && typeof token === 'string' && token.trim() !== '');
    if (validTokens.length === 0) return;

    const results = await Promise.allSettled(validTokens.map(async token => {
      const message = {
        notification: { title, body },
        data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
        token,
      };
      return await admin.messaging().send(message);
    }));

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedTokens = results
      .map((r, i) => r.status === 'rejected' ? validTokens[i] : null)
      .filter(Boolean);
    const failureCount = failedTokens.length;

    console.log(`Notification send complete: ${successCount} successes, ${failureCount} failures.`);
    if (failureCount) console.log('Failed tokens:', failedTokens);

    return { successCount, failureCount, failedTokens };
  } catch (error) {
    console.error('Error sending notification via Firebase:', error);
  }
};
