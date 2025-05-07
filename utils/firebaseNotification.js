import FCM from 'fcm-node';
const serverKey = process.env.FCM_SERVER_KEY; // Make sure this is set in your .env

if (!serverKey) {
  console.warn("FCM_SERVER_KEY is not set. Firebase notifications will not be sent.");
}
// Initialize fcm only if serverKey is present, to avoid crashes if not configured
const fcm = serverKey ? new FCM(serverKey) : null;

/**
 * Sends Firebase Cloud Messaging (FCM) notifications to multiple devices.
 * @param {string[]} deviceTokens - An array of FCM registration tokens.
 * @param {string} title - The title of the notification.
 * @param {string} body - The main text content of the notification.
 * @param {object} [data={}] - Optional custom data payload to send with the notification.
 * @returns {Promise<object|null>} A promise that resolves with the FCM response or null if not sent.
 */
const sendFirebaseNotification = async ({ deviceTokens, title, body, data = {} }) => {
  if (!fcm) {
    console.log("FCM service is not initialized (server key missing). Skipping notification.");
    return Promise.resolve(null); // Resolve without error if FCM is not configured
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    console.log("No device tokens provided for FCM notification.");
    return Promise.resolve(null); // Or reject, depending on desired behavior
  }

  const message = {
    registration_ids: deviceTokens, // Use registration_ids for multiple tokens
    notification: {
      title,
      body,
      // You can add more Android/iOS specific options here if needed
      // e.g., sound: "default", icon: "ic_notification"
    },
    data: { // Custom payload
      ...data,
      click_action: "FLUTTER_NOTIFICATION_CLICK", // Often used by Flutter
    },
    priority: 'high',
  };

  return new Promise((resolve, reject) => {
    fcm.send(message, (err, response) => {
      if (err) {
        console.error('FCM send failed:', err);
        // Don't reject the entire operation for a notification failure,
        // but log it and potentially handle it (e.g., mark tokens as invalid).
        // For simplicity here, we resolve with the error details.
        resolve({ error: err, response: null }); // Resolve so the main flow continues
      } else {
        console.log('FCM send success:', response);
        resolve({ error: null, response });
      }
    });
  });
};

export default sendFirebaseNotification;

// import admin from "firebase-admin"

// const sendFirebaseNotification = async (tokens, notificationData) => {
//   if (!tokens || tokens.length === 0) return;

//   try {
//     const message = {
//       notification: {
//         title: notificationData.title,
//         body: notificationData.description,
//       },
//       data: {
//         type: notificationData.type,
//         projectId: notificationData.projectId?.toString() || '',
//         click_action: 'FLUTTER_NOTIFICATION_CLICK',
//       },
//       tokens: tokens.filter(Boolean), // Remove any null/undefined tokens
//     };

//     const response = await admin.messaging().sendMulticast(message);
//     console.log('Successfully sent FCM notification:', response);
//     return response;
//   } catch (error) {
//     console.error('Error sending FCM notification:', error);
//     throw error;
//   }
// };

// export default sendFirebaseNotification ;

// firebaseNotifications.js



// import FCM from 'fcm-node';
// const serverKey = process.env.FCM_SERVER_KEY;
// const fcm = new FCM(serverKey);

// const sendFirebaseNotification = async ({ deviceToken, title, body, data = {} }) => {
//   const message = {
//     to: deviceToken,
//     notification: {
//       title,
//       body,
//     },
//     data,
//     priority: 'high',
//   };

//   return new Promise((resolve, reject) => {
//     fcm.send(message, (err, response) => {
//       if (err) {
//         console.error('Push notification failed:', err);
//         return reject(err);
//       }
//       console.log('Push notification success:', response);
//       resolve(response);
//     });
//   });
// };

// export default sendFirebaseNotification;
