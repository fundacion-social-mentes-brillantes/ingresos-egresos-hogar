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
  writeBatch,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Transaction, Account, ChatMessage, AppSettings, UserProfile } from '../types';

// -- Path helpers ------------------------------------------------------------
const userRef = (uid: string) => doc(db, 'users', uid);
const txCol = (uid: string) => collection(db, 'users', uid, 'transactions');
const txRef = (uid: string, id: string) => doc(db, 'users', uid, 'transactions', id);
const accCol = (uid: string) => collection(db, 'users', uid, 'accounts');
const accRef = (uid: string, id: string) => doc(db, 'users', uid, 'accounts', id);
const chatCol = (uid: string) => collection(db, 'users', uid, 'chatMessages');
const settRef = (uid: string) => doc(db, 'users', uid, 'settings', 'app');

function cleanUndefinedFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeTransaction(id: string, data: Record<string, any>): Transaction {
  return {
    id,
    ...data,
    amount: Number(data.amount || 0),
    date: toDate(data.date),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Transaction;
}

// -- User profile ------------------------------------------------------------
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { ...data, uid, createdAt: toDate(data.createdAt) } as UserProfile;
}

export async function createUserProfile(uid: string, data: Omit<UserProfile, 'uid' | 'createdAt'>) {
  await setDoc(
    userRef(uid),
    {
      ...data,
      defaultCurrency: 'COP',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// -- Accounts ----------------------------------------------------------------
export async function getAccounts(uid: string): Promise<Account[]> {
  const snap = await getDocs(query(accCol(uid), orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    currentBalance: Number(d.data().currentBalance || 0),
    initialBalance: Number(d.data().initialBalance || 0),
    createdAt: toDate(d.data().createdAt),
  })) as Account[];
}

export async function addAccount(uid: string, data: Omit<Account, 'id' | 'createdAt'>) {
  return addDoc(accCol(uid), {
    ...data,
    initialBalance: Number(data.initialBalance || 0),
    currentBalance: Number(data.currentBalance || 0),
    active: data.active ?? true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateAccount(uid: string, id: string, data: Partial<Account>) {
  return updateDoc(accRef(uid, id), { ...data, updatedAt: serverTimestamp() });
}

// -- Transactions ------------------------------------------------------------
export async function getTransactions(uid: string, limitCount = 100): Promise<Transaction[]> {
  const snap = await getDocs(query(txCol(uid), orderBy('date', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => normalizeTransaction(d.id, d.data()));
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
  return snap.docs.map((d) => normalizeTransaction(d.id, d.data()));
}

export async function addTransaction(uid: string, data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
  const batch = writeBatch(db);
  const newTxRef = doc(txCol(uid));
  const amount = Number(data.amount || 0);

  batch.set(newTxRef, {
    ...data,
    amount,
    currency: data.currency || 'COP',
    date: Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (data.accountId) {
    const balanceChange = data.type === 'income' ? amount : -amount;
    batch.update(accRef(uid, data.accountId), {
      currentBalance: increment(balanceChange),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return newTxRef;
}

export async function updateTransaction(uid: string, id: string, data: Partial<Transaction>) {
  const payload: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  if (data.date) payload.date = Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date));
  return updateDoc(txRef(uid, id), payload);
}

export async function deleteTransaction(uid: string, id: string) {
  const current = await getDoc(txRef(uid, id));
  if (!current.exists()) return;

  const tx = current.data() as Partial<Transaction>;
  const batch = writeBatch(db);
  batch.delete(txRef(uid, id));

  if (tx.accountId && typeof tx.amount === 'number' && tx.type) {
    const reverseBalance = tx.type === 'income' ? -tx.amount : tx.amount;
    batch.update(accRef(uid, tx.accountId), {
      currentBalance: increment(reverseBalance),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

// -- Chat messages -----------------------------------------------------------
export async function getChatMessages(uid: string, limitCount = 50): Promise<ChatMessage[]> {
  const snap = await getDocs(query(chatCol(uid), orderBy('createdAt', 'asc'), limit(limitCount)));
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: toDate(d.data().createdAt),
  })) as ChatMessage[];
}

export async function addChatMessage(uid: string, data: Omit<ChatMessage, 'id' | 'createdAt'>) {
  return addDoc(chatCol(uid), cleanUndefinedFields({ ...data, createdAt: serverTimestamp() }));
}

// -- Settings ----------------------------------------------------------------
export async function getSettings(uid: string): Promise<AppSettings> {
  const snap = await getDoc(settRef(uid));
  if (!snap.exists()) {
    return { autoCreateTransactions: true, askConfirmationWhenAmbiguous: true, monthlyStartDay: 1 };
  }
  return snap.data() as AppSettings;
}

export async function updateSettings(uid: string, data: Partial<AppSettings>) {
  return setDoc(settRef(uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
