const admin = require('firebase-admin');

/**
 * Initializes the Firebase Admin SDK exactly once, using a service account
 * loaded from environment variables (see .env.example):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (keep the \n escapes - see note below)
 *
 * Get these three values from Firebase Console -> Project Settings ->
 * Service accounts -> Generate new private key. That downloads a JSON file;
 * copy `project_id`, `client_email`, and `private_key` from it into your
 * .env. Because .env values are single-line, the private key's real
 * newlines need to be written as literal `\n` - this module converts them
 * back before handing the key to the SDK.
 */
let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      'Firebase Admin SDK is not configured (missing FIREBASE_PROJECT_ID / ' +
        'FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) - push notifications will be skipped.'
    );
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  initialized = true;
  return admin;
}

module.exports = { initFirebaseAdmin };
