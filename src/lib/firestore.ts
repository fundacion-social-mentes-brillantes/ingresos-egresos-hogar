// Firestore helpers for the frontend

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  limit,
  where,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Transaction, Account, ChatMessage, AppSettings, UserProfile } from '../types';

// ── Path helpers ────────────────────────────────────────────────────────────
const userRef  = (uid: string) => doc(db, 'users', uid);
const txCol    = (uid: string) => collection(db, 'users', uid, 'transactions');
const txRef    = (uid: string, id: string) => doc(db, 'users', uid, 'transactions', id);
const accCol   = (uid: string) => collection(db, 'users', uid, 'accounts');
const chatCol  = (uid: string) => collection(db, 'users', uid, 'chatMessages');
const settRef  = (uid: string) => doc(db, 'users', uid, 'settings', 'app');

// ── User profile ────────────────────────────────────────────────────────────
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userRef(uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { ...d, uid, createdAt: d.createdAt?.toDate() } as UserProfile;
}

export async function createUserProfile(uid: string, data: Omit<UserProfile, 'uid' | 'createdAt'>) {
  await setDoc(userRef(uid), { ...data, createdAt: serverTimestamp(), defaultCurrency: 'COP' });
}

// ── Accounts ────────────────────────────────────────────────────────────────
export async function getAccounts(uid: string): Promise<Account[]> {
  const snap = await getDocs(query(accCol(uid), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate(),
  })) as Account[];
}

export async function addAccount(uid: string, data: Omit<Account, 'id' | 'createdAt'>) {
  return addDoc(accCol(uid), { ...data, createdAt: serverTimestamp() });
}

export async function updateAccount(uid: string, id: string, data: Partial<Account>) {
  return updateDoc(doc(accCol(uid), id), data);
}

// ── Transactions ────────────────────────────────────────────────────────────
export async function getTransactions(uid: string, limitCount = 100): Promise<Transaction[]> {
  const snap = await getDocs(
    query(txCol(uid), orderBy('date', 'desc'), limit(limitCount))
  );
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    date:      d.data().date?.toDate(),
    createdAt: d.data().createdAt?.toDate(),
    updatedAt: d.data().updatedAt?.toDate(),
  })) as Transaction[];
}

export async function getTransactionsByRange(
  uid: string,
  startDate: Date,
  endDate: Date
): Promise<Transaction[]> {
  const snap = await getDocs(
    query(
      txCol(uid),
      where('date', '>=', Timestamp.fromDate(startDate)),
      where('date', '<=', Timestamp.fromDate(endDate)),
      orderBy('date', 'desc')
    )
  );
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    date:      d.data().date?.toDate(),
    createdAt: d.data().createdAt?.toDate(),
    updatedAt: d.data().updatedAt?.toDate(),
  })) as Transaction[];
}

export async function addTransaction(uid: string, data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
  return addDoc(txCol(uid), {
    ...data,
    date: Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTransaction(uid: string, id: string, data: Partial<Transaction>) {
  const payload: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  if (data.date) payload.date = Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date));
  return updateDoc(txRef(uid, id), payload);
}

export async function deleteTransaction(uid: string, id: string) {
  return deleteDoc(txRef(uid, id));
}

// ── Chat messages ───────────────────────────────────────────────────────────
export async function getChatMessages(uid: string, limitCount = 50): Promise<ChatMessage[]> {
  const snap = await getDocs(
    query(chatCol(uid), orderBy('createdAt', 'asc'), limit(limitCount))
  );
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate(),
  })) as ChatMessage[];
}

export async function addChatMessage(uid: string, data: Omit<ChatMessage, 'id' | 'createdAt'>) {
  return addDoc(chatCol(uid), { ...data, createdAt: serverTimestamp() });
}

// ── Settings ────────────────────────────────────────────────────────────────
export async function getSettings(uid: string): Promise<AppSettings> {
  const snap = await getDoc(settRef(uid));
  if (!snap.exists()) {
    return { autoCreateTransactions: true, askConfirmationWhenAmbiguous: true, monthlyStartDay: 1 };
  }
  return snap.data() as AppSettings;
}

export async function updateSettings(uid: string, data: Partial<AppSettings>) {
  return setDoc(settRef(uid), data, { merge: true });
}
