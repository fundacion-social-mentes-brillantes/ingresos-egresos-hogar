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
import type {
  Transaction,
  Account,
  ChatMessage,
  AppSettings,
  UserProfile,
  Debt,
  DeletedTransaction,
  ActionLog,
} from '../types';

// -- Path helpers ------------------------------------------------------------
const userRef = (uid: string) => doc(db, 'users', uid);
const txCol = (uid: string) => collection(db, 'users', uid, 'transactions');
const txRef = (uid: string, id: string) => doc(db, 'users', uid, 'transactions', id);
const deletedTxCol = (uid: string) => collection(db, 'users', uid, 'deletedTransactions');
const deletedTxRef = (uid: string, id: string) => doc(db, 'users', uid, 'deletedTransactions', id);
const debtCol = (uid: string) => collection(db, 'users', uid, 'debts');
const debtRef = (uid: string, id: string) => doc(db, 'users', uid, 'debts', id);
const accCol = (uid: string) => collection(db, 'users', uid, 'accounts');
const accRef = (uid: string, id: string) => doc(db, 'users', uid, 'accounts', id);
const chatCol = (uid: string) => collection(db, 'users', uid, 'chatMessages');
const actionLogCol = (uid: string) => collection(db, 'users', uid, 'actionLogs');
const settRef = (uid: string) => doc(db, 'users', uid, 'settings', 'app');

type FirestoreObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is FirestoreObject {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanFirestoreValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanFirestoreValue(item))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cleanFirestoreValue(item)] as const)
      .filter(([, item]) => item !== undefined)
  );
}

function cleanUndefinedFields<T extends FirestoreObject>(data: T): Partial<T> {
  return cleanFirestoreValue(data) as Partial<T>;
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

function toOptionalDate(value: unknown): Date | null {
  if (!value) return null;
  return toDate(value);
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

function normalizeDeletedTransaction(id: string, data: Record<string, any>): DeletedTransaction {
  const originalId = String(data.originalId || id);
  return {
    ...normalizeTransaction(originalId, data),
    deletedId: id,
    originalId,
    deletedAt: toDate(data.deletedAt),
    recoverable: data.recoverable ?? true,
  } as DeletedTransaction;
}

function normalizeDebt(id: string, data: Record<string, any>): Debt {
  const amountOriginal = Number(data.amountOriginal || 0);
  const amountPaid = Number(data.amountPaid || 0);
  const status = data.status || (amountPaid >= amountOriginal ? 'paid' : amountPaid > 0 ? 'partial' : 'open');

  return {
    id,
    ...data,
    amountOriginal,
    amountPaid,
    status,
    dueDate: toOptionalDate(data.dueDate),
    closedAt: toOptionalDate(data.closedAt),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Debt;
}

function normalizeActionLog(id: string, data: Record<string, any>): ActionLog {
  return {
    id,
    ...data,
    createdAt: toDate(data.createdAt),
  } as ActionLog;
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
    cleanUndefinedFields({
      ...data,
      defaultCurrency: 'COP',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

export async function updateUserProfile(uid: string, data: Partial<Omit<UserProfile, 'uid' | 'createdAt'>>) {
  return setDoc(userRef(uid), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }), { merge: true });
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
  return addDoc(accCol(uid), cleanUndefinedFields({
    ...data,
    initialBalance: Number(data.initialBalance || 0),
    currentBalance: Number(data.currentBalance || 0),
    active: data.active ?? true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

export async function updateAccount(uid: string, id: string, data: Partial<Account>) {
  return updateDoc(accRef(uid, id), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }));
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

  batch.set(newTxRef, cleanUndefinedFields({
    ...data,
    amount,
    currency: data.currency || 'COP',
    category: data.category || (data.type === 'income' ? 'Ingreso' : 'Otros'),
    accountName: data.accountName || 'Efectivo',
    description: data.description || 'Movimiento registrado desde el chat',
    date: Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  if (data.accountId) {
    const balanceChange = data.type === 'income' ? amount : -amount;
    batch.update(accRef(uid, data.accountId), cleanUndefinedFields({
      currentBalance: increment(balanceChange),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  return newTxRef;
}

export async function updateTransaction(uid: string, id: string, data: Partial<Transaction>) {
  const current = await getDoc(txRef(uid, id));
  if (!current.exists()) return;

  const previous = normalizeTransaction(current.id, current.data());
  const nextType = data.type || previous.type;
  const nextAmount = Number(data.amount ?? previous.amount);
  const nextAccountId = data.accountId || previous.accountId;
  const payload: Record<string, unknown> = cleanUndefinedFields({ ...data, amount: nextAmount, updatedAt: serverTimestamp() });
  if (data.date) payload.date = Timestamp.fromDate(data.date instanceof Date ? data.date : new Date(data.date));

  const batch = writeBatch(db);
  batch.update(txRef(uid, id), cleanUndefinedFields(payload));

  const oldEffect = previous.type === 'income' ? previous.amount : -previous.amount;
  const newEffect = nextType === 'income' ? nextAmount : -nextAmount;
  if (previous.accountId && nextAccountId && previous.accountId === nextAccountId) {
    const delta = newEffect - oldEffect;
    if (delta !== 0) {
      batch.update(accRef(uid, nextAccountId), cleanUndefinedFields({ currentBalance: increment(delta), updatedAt: serverTimestamp() }));
    }
  } else {
    if (previous.accountId) batch.update(accRef(uid, previous.accountId), cleanUndefinedFields({ currentBalance: increment(-oldEffect), updatedAt: serverTimestamp() }));
    if (nextAccountId) batch.update(accRef(uid, nextAccountId), cleanUndefinedFields({ currentBalance: increment(newEffect), updatedAt: serverTimestamp() }));
  }

  await batch.commit();
}

export async function deleteTransaction(uid: string, id: string) {
  const current = await getDoc(txRef(uid, id));
  if (!current.exists()) return null;

  const tx = current.data() as Partial<Transaction>;
  const batch = writeBatch(db);
  const deletedRef = doc(deletedTxCol(uid));
  batch.set(deletedRef, cleanUndefinedFields({
    ...tx,
    originalId: id,
    deletedAt: serverTimestamp(),
    recoverable: true,
  }));
  batch.delete(txRef(uid, id));

  if (tx.accountId && typeof tx.amount === 'number' && tx.type) {
    const reverseBalance = tx.type === 'income' ? -tx.amount : tx.amount;
    batch.update(accRef(uid, tx.accountId), cleanUndefinedFields({
      currentBalance: increment(reverseBalance),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  return deletedRef.id;
}

export async function getDeletedTransactions(uid: string, limitCount = 25): Promise<DeletedTransaction[]> {
  const snap = await getDocs(query(deletedTxCol(uid), orderBy('deletedAt', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => normalizeDeletedTransaction(d.id, d.data()));
}

export async function restoreDeletedTransaction(uid: string, deletedId: string): Promise<Transaction | null> {
  const deletedSnap = await getDoc(deletedTxRef(uid, deletedId));
  if (!deletedSnap.exists()) return null;

  const data = deletedSnap.data() as Record<string, any>;
  const originalId = String(data.originalId || deletedSnap.id);
  const restoredData = { ...data };
  delete restoredData.originalId;
  delete restoredData.deletedAt;
  delete restoredData.recoverable;

  const restored = normalizeTransaction(originalId, restoredData);
  const batch = writeBatch(db);
  batch.set(txRef(uid, originalId), cleanUndefinedFields({
    ...restoredData,
    restoredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  batch.delete(deletedTxRef(uid, deletedSnap.id));

  if (restored.accountId && restored.amount && restored.type) {
    const balanceChange = restored.type === 'income' ? restored.amount : -restored.amount;
    batch.update(accRef(uid, restored.accountId), cleanUndefinedFields({
      currentBalance: increment(balanceChange),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  return restored;
}

export async function restoreLastDeletedTransaction(uid: string): Promise<Transaction | null> {
  const snap = await getDocs(query(deletedTxCol(uid), orderBy('deletedAt', 'desc'), limit(1)));
  const deleted = snap.docs[0];
  if (!deleted) return null;
  return restoreDeletedTransaction(uid, deleted.id);
}

// -- Debts and loans ---------------------------------------------------------
export async function getDebts(uid: string, limitCount = 100): Promise<Debt[]> {
  const snap = await getDocs(query(debtCol(uid), orderBy('createdAt', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => normalizeDebt(d.id, d.data()));
}

export async function addDebt(uid: string, data: Omit<Debt, 'id' | 'createdAt' | 'updatedAt'>) {
  const amountOriginal = Number(data.amountOriginal || 0);
  const amountPaid = Number(data.amountPaid || 0);
  return addDoc(debtCol(uid), cleanUndefinedFields({
    ...data,
    amountOriginal,
    amountPaid,
    currency: data.currency || 'COP',
    status: data.status || (amountPaid >= amountOriginal ? 'paid' : amountPaid > 0 ? 'partial' : 'open'),
    dueDate: data.dueDate ? Timestamp.fromDate(data.dueDate) : null,
    closedAt: data.closedAt ? Timestamp.fromDate(data.closedAt) : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

export async function updateDebt(uid: string, id: string, data: Partial<Debt>) {
  const payload: Record<string, unknown> = cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() });
  if (data.dueDate !== undefined) payload.dueDate = data.dueDate ? Timestamp.fromDate(data.dueDate) : null;
  if (data.closedAt !== undefined) payload.closedAt = data.closedAt ? Timestamp.fromDate(data.closedAt) : null;
  return updateDoc(debtRef(uid, id), cleanUndefinedFields(payload));
}

export async function deleteDebt(uid: string, id: string) {
  return deleteDoc(debtRef(uid, id));
}

export async function registerDebtPayment(uid: string, id: string, amount: number) {
  const current = await getDoc(debtRef(uid, id));
  if (!current.exists()) return;

  const debt = normalizeDebt(current.id, current.data());
  const newPaid = Math.min(debt.amountOriginal, debt.amountPaid + Number(amount || 0));
  const newStatus = newPaid >= debt.amountOriginal ? 'paid' : newPaid > 0 ? 'partial' : 'open';
  return updateDebt(uid, id, {
    amountPaid: newPaid,
    status: newStatus,
    closedAt: newStatus === 'paid' ? new Date() : null,
  });
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

// -- Action logs -------------------------------------------------------------
export async function addActionLog(uid: string, data: Omit<ActionLog, 'id' | 'createdAt'>) {
  try {
    return await addDoc(actionLogCol(uid), cleanUndefinedFields({ ...data, createdAt: serverTimestamp() }));
  } catch (error) {
    // Action logs are useful for audit/history, but they must never block the bot.
    // This protects production when Firestore rules for actionLogs are not deployed yet.
    console.debug('Action log skipped:', error);
    return null;
  }
}

export async function getActionLogs(uid: string, limitCount = 50): Promise<ActionLog[]> {
  const snap = await getDocs(query(actionLogCol(uid), orderBy('createdAt', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => normalizeActionLog(d.id, d.data()));
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
  return setDoc(settRef(uid), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }), { merge: true });
}
