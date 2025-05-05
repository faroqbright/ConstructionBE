const admin = require('firebase-admin');
const serviceAccount = require('./path-to-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const messaging = admin.messaging();

const sendNotificationToDevices = async (tokens, title, body, data = {}) => {
  const message = {
    tokens,
    notification: { title, body },
    data
  };

  
  try {
    const response = await messaging.sendMulticast(message);
    return response;
  } catch (error) {
    console.error('Error sending notifications:', error);
    throw error;
  }
};

module.exports = { sendNotificationToDevices };