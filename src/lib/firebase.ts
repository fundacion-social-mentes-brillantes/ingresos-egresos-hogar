// ─────────────────────────────────────────────────────────────────────────────
// Firebase configuration
// Replace the values below with your project's Firebase config.
// NEVER commit real API keys. Use a .env file and add it to .gitignore.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { BotResponse, FinancialSummary, QueryRange, ChatWithBotRequest } from '../types';

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
export const functions = getFunctions(app, 'us-central1');

// ── Callable functions ──────────────────────────────────────────────────────

export const callChatWithBot = httpsCallable<
  ChatWithBotRequest,
  BotResponse
>(functions, 'chatWithBot');

export const callGetFinancialSummary = httpsCallable<
  { range: QueryRange; startDate?: string; endDate?: string },
  FinancialSummary
>(functions, 'getFinancialSummary');

export const callSeedDefaultUserData = httpsCallable<
  Record<string, never>,
  { success: boolean }
>(functions, 'seedDefaultUserData');
