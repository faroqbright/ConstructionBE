// ../utils/firebase.service.js
// Per-token send + detailed logs. Callers use (tokens, title, body, data).
// Optional legacy: (userId, tokens, title, body, data) when userId is a valid ObjectId.
import admin from "firebase-admin";
import mongoose from "mongoose";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { NotificationSetting } from "../models/notificationSetting.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, "construct-flow-50bcd638645c.json");

let initialized = false;
/** Single-flight init: first push must wait for Admin SDK, not race past `initialized === false`. */
let initPromise = null;

async function ensureFirebaseInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      const serviceAccountString = await readFile(serviceAccountPath, "utf8");
      const serviceAccount = JSON.parse(serviceAccountString);
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      initialized = true;
      console.log("Firebase Admin SDK initialized successfully.");
    })().catch((err) => {
      initPromise = null;
      initialized = false;
      throw err;
    });
  }
  await initPromise;
}

/** FCM `data` payload values must be strings */
function stringifyDataPayload(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export const sendNotification = async (a, b, c, d, e) => {
  try {
    await ensureFirebaseInitialized();
  } catch (error) {
    console.error("Firebase Admin SDK not initialized. Cannot send notification.", error);
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }

  if (!initialized) {
    console.error("Firebase Admin SDK not initialized. Cannot send notification.");
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }

  let userId = null;
  let tokens;
  let title;
  let body;
  let data = {};

  if (Array.isArray(a)) {
    tokens = a;
    title = b;
    body = c;
    data = d && typeof d === "object" ? d : {};
  } else {
    userId = a;
    tokens = b;
    title = c;
    body = d;
    data = e && typeof e === "object" ? e : {};
  }

  try {
    if (userId != null && mongoose.Types.ObjectId.isValid(String(userId))) {
      const setting = await NotificationSetting.findOne({ userId });
      if (setting && setting.status === false) {
        console.log(`[Firebase] Skipping notification for user ${userId} - notifications disabled`);
        return { successCount: 0, failureCount: 0, failedTokens: [] };
      }
    }

    if (!tokens || tokens.length === 0) {
      console.log("No tokens provided for notification");
      return { successCount: 0, failureCount: 0, failedTokens: [] };
    }

    const validTokens = tokens.filter(
      (token) =>
        token &&
        typeof token === "string" &&
        token.trim() !== "" &&
        token !== "fcmDeviceToken"
    );

    if (validTokens.length === 0) {
      console.log("No valid tokens available for notification");
      return { successCount: 0, failureCount: 0, failedTokens: [] };
    }

    const safeTitle = title != null && String(title).trim() !== "" ? String(title) : "Notification";
    const safeBody = body != null && String(body).trim() !== "" ? String(body) : "You have a new update.";

    const dataPayload = {
      ...stringifyDataPayload(data),
      click_action: "FLUTTER_NOTIFICATION_CLICK",
    };

    let successCount = 0;
    let failureCount = 0;
    const failedTokens = [];

    for (const token of validTokens) {
      try {
        const message = {
          notification: { title: safeTitle, body: safeBody },
          data: dataPayload,
          token,
          // Improves chance of system tray delivery when app is backgrounded / screen off
          android: { priority: "high" },
          apns: {
            headers: { "apns-priority": "10", "apns-push-type": "alert" },
          },
        };
        const response = await admin.messaging().send(message);
        console.log(`Successfully sent message to ${token}:`, response);
        successCount++;
      } catch (err) {
        console.error(`Failed to send to token ${token}:`, err.message);
        if (err.errorInfo) {
          console.error("Error Info:", JSON.stringify(err.errorInfo, null, 2));
        }
        failedTokens.push(token);
        failureCount++;
      }
    }

    console.log(`Notification send complete: ${successCount} successes, ${failureCount} failures.`);
    if (failedTokens.length > 0) {
      console.log("List of tokens that failed:", failedTokens);
    }

    return { successCount, failureCount, failedTokens };
  } catch (error) {
    console.error("Error sending notification via Firebase:", error);
  }
  return { successCount: 0, failureCount: 0, failedTokens: [] };
};
