// ─────────────────────────────────────────────────────────────────────────────
// Firebase configuration
// Replace the values below with your project's Firebase config.
// NEVER commit real API keys. Use a .env file and add it to .gitignore.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// Nota: la app NO usa Cloud Functions. El chat corre en Vercel (/api/deepseek-chat)
// y la creacion de cuentas por defecto se hace en el cliente (ensureDefaultAccounts
// en firestore.ts). Asi el proyecto de Firebase puede quedar en plan gratuito.
