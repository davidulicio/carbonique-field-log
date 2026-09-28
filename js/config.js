// ------------------------------------------------------------------
// Field Log configuration
// ------------------------------------------------------------------
// 1. Paste the "firebaseConfig" object from Firebase console
//    (Project settings > General > Your apps > Web app) below.
// 2. While apiKey is empty, the app runs in DEMO MODE: everything is
//    stored only in your own browser, which is handy for trying it out.
// ------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyC1ZP4uyav41u4QUwAZLQxqLUWcM2IfFbU",
  authDomain: "carbonique-field-log.firebaseapp.com",
  projectId: "carbonique-field-log",
  storageBucket: "carbonique-field-log.firebasestorage.app",
  messagingSenderId: "174938675917",
  appId: "1:174938675917:web:ebfce822e65ecae3cca784"
};

// Browser tab title, and the name shown next to the Carbonique logo.
export const APP_TITLE = "Carbonique Field Log";
export const APP_NAME = "Field Log";

// Only used in demo mode: this email becomes the admin when you sign in with it.
// In the real app the admin is set in firestore.rules (never in this public file).
export const DEMO_ADMIN_EMAIL = "admin@example.com";
