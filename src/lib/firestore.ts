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
} from 'firebase/firestore';
import { db } from './firebase';
import { createAccountingTransaction, reverseAccountingTransaction } from './accountingOperations';
import { transferBetweenAccountsSafe } from './transferOperations';
import { createDebtWithMoneyMovement, registerDebtPaymentWithMoneyMovement, voidDebtWithMoneyMovements } from './debtMoney';
import { inferMovementKind, isProtectedTransaction, toMoney } from './accounting';
import type {
  Transaction,
  Account,
  ChatMessage,
  AppSettings,
  UserProfile,
  Debt,
  DeletedTransaction,
  ActionLog,
  MovementKind,
} from '../types';
import type { BatchImportPreview } from './batchImportParser';

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

type LegacyTransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
type LegacyDebtInput = Omit<Debt, 'id' | 'createdAt' | 'updatedAt'> & { linkedAccountId?: string; linkedAccountName?: string };

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
  if (Array.isArray(value)) return value.map((item) => cleanFirestoreValue(item)).filter((item) => item !== undefined);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanFirestoreValue(item)] as const).filter(([, item]) => item !== undefined));
}

function cleanUndefinedFields<T extends FirestoreObject>(data: T): Partial<T> {
  return cleanFirestoreValue(data) as Partial<T>;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
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

function normalizeComparableName(value: string): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTransaction(id: string, data: Record<string, any>): Transaction {
  return { id, ...data, amount: toMoney(data.amount), date: toDate(data.date), createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as Transaction;
}

function normalizeDeletedTransaction(id: string, data: Record<string, any>): DeletedTransaction {
  const originalId = String(data.originalId || id);
  return { ...normalizeTransaction(originalId, data), deletedId: id, originalId, deletedAt: toDate(data.deletedAt), recoverable: data.recoverable ?? true } as DeletedTransaction;
}

function normalizeDebt(id: string, data: Record<string, any>): Debt {
  const amountOriginal = toMoney(data.amountOriginal || 0);
  const amountPaid = toMoney(data.amountPaid || 0);
  const status = data.status || (amountPaid >= amountOriginal ? 'paid' : amountPaid > 0 ? 'partial' : 'open');
  return { id, ...data, amountOriginal, amountPaid, status, dueDate: toOptionalDate(data.dueDate), closedAt: toOptionalDate(data.closedAt), createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as Debt;
}

function normalizeActionLog(id: string, data: Record<string, any>): ActionLog {
  return { id, ...data, createdAt: toDate(data.createdAt) } as ActionLog;
}

async function getAccountById(uid: string, id: string): Promise<Account> {
  const snap = await getDoc(accRef(uid, id));
  if (!snap.exists()) throw new Error('La cuenta no existe.');
  const data = snap.data();
  return { id: snap.id, ...data, currentBalance: toMoney(data.currentBalance), initialBalance: toMoney(data.initialBalance), createdAt: toDate(data.createdAt) } as Account;
}

function safeMovementKind(data: Partial<Transaction>): MovementKind {
  const kind = inferMovementKind(data);
  if (kind === 'legacy') return data.type === 'income' ? 'income' : 'expense';
  return kind;
}

function hasFinancialDebtPatch(data: Partial<Debt>): boolean {
  return ['amountOriginal', 'amountPaid', 'status', 'closedAt', 'direction'].some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

// -- User profile ------------------------------------------------------------
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { ...data, uid, createdAt: toDate(data.createdAt) } as UserProfile;
}

export async function createUserProfile(uid: string, data: Omit<UserProfile, 'uid' | 'createdAt'>) {
  await setDoc(userRef(uid), cleanUndefinedFields({ ...data, defaultCurrency: 'COP', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
}

export async function updateUserProfile(uid: string, data: Partial<Omit<UserProfile, 'uid' | 'createdAt'>>) {
  return setDoc(userRef(uid), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }), { merge: true });
}

// -- Accounts ----------------------------------------------------------------
export async function getAccounts(uid: string): Promise<Account[]> {
  const snap = await getDocs(query(accCol(uid), orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), currentBalance: toMoney(d.data().currentBalance), calculatedBalance: toMoney(d.data().calculatedBalance), realBalance: d.data().realBalance, initialBalance: toMoney(d.data().initialBalance), createdAt: toDate(d.data().createdAt) })) as Account[];
}

export async function addAccount(uid: string, data: Omit<Account, 'id' | 'createdAt'>) {
  const initialBalance = toMoney(data.initialBalance || data.currentBalance || 0);
  const currentBalance = toMoney(data.currentBalance ?? initialBalance);
  return addDoc(accCol(uid), cleanUndefinedFields({ ...data, initialBalance, currentBalance, calculatedBalance: currentBalance, active: data.active ?? true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
}

export async function updateAccount(uid: string, id: string, data: Partial<Account>) {
  return updateDoc(accRef(uid, id), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }));
}

export async function createBatchImportFromPreview(uid: string, preview: BatchImportPreview) {
  const accountName = preview.accountName.trim();
  const duplicate = (await getAccounts(uid)).find((account) => normalizeComparableName(account.name) === normalizeComparableName(accountName));
  const batch = writeBatch(db);
  const targetAccountRef = duplicate ? accRef(uid, duplicate.id) : doc(accCol(uid));
  const batchImportId = targetAccountRef.id;
  const importedAt = new Date();
  const initialBalance = toMoney(preview.totalValue || 0);
  const currentBalance = toMoney(preview.expectedPendingBalance || 0);

  if (duplicate?.batchImportId) throw new Error(`La cuenta ${duplicate.name} ya parece tener una importacion por lote. No se guardo nada para evitar duplicados.`);

  const accountPayload = { initialBalance, currentBalance, calculatedBalance: currentBalance, active: true, batchImportId, updatedAt: serverTimestamp() };
  if (duplicate) batch.update(targetAccountRef, cleanUndefinedFields(accountPayload));
  else batch.set(targetAccountRef, cleanUndefinedFields({ name: accountName, type: 'other' as const, ...accountPayload, createdAt: serverTimestamp() }));

  preview.movements.forEach((movement, index) => {
    const newTransactionRef = doc(txCol(uid));
    batch.set(newTransactionRef, cleanUndefinedFields({
      type: 'expense' as const,
      amount: toMoney(movement.amount || 0),
      currency: 'COP' as const,
      category: 'Abono / Descuento',
      accountId: targetAccountRef.id,
      accountName,
      description: movement.description,
      date: Timestamp.fromDate(importedAt),
      rawText: preview.rawText,
      source: 'manual' as const,
      confidence: 1,
      movementKind: 'historical_non_reportable' as const,
      affectsCash: true,
      affectsReport: false,
      affectsDebt: false,
      excludeFromReports: true,
      batchImportId,
      importRow: index + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  await batch.commit();
  return { accountId: targetAccountRef.id, accountName: duplicate?.name || accountName, count: preview.movements.length };
}

export async function transferBetweenAccounts(uid: string, params: { fromAccountId: string; toAccountId: string; amount: number; description?: string; date?: Date; allowNegativeBalance?: boolean; }) {
  return transferBetweenAccountsSafe(uid, params);
}

// -- Transactions ------------------------------------------------------------
export async function getTransactions(uid: string, limitCount = 100): Promise<Transaction[]> {
  const snap = await getDocs(query(txCol(uid), orderBy('date', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => normalizeTransaction(d.id, d.data()));
}

export async function getTransactionsByRange(uid: string, startDate: Date, endDate: Date): Promise<Transaction[]> {
  const snap = await getDocs(query(txCol(uid), where('date', '>=', Timestamp.fromDate(startDate)), where('date', '<=', Timestamp.fromDate(endDate)), orderBy('date', 'desc')));
  return snap.docs.map((d) => normalizeTransaction(d.id, d.data()));
}

export async function addTransaction(uid: string, data: LegacyTransactionInput) {
  if (!data.accountId) throw new Error('Para registrar un movimiento se necesita una cuenta real.');
  if (data.transferId || data.debtId || data.debtMovementKind) throw new Error('Movimiento protegido: usa el flujo seguro de transferencias o deudas.');
  return createAccountingTransaction(uid, {
    type: data.type,
    amount: data.amount,
    accountId: data.accountId,
    category: data.category || (data.type === 'income' ? 'Ingreso' : 'Otros'),
    description: data.description || 'Movimiento registrado',
    date: data.date instanceof Date ? data.date : toDate(data.date),
    source: data.source || 'manual',
    rawText: data.rawText || data.description || '',
    movementKind: safeMovementKind(data),
    excludeFromReports: data.excludeFromReports,
  });
}

export async function updateTransaction(uid: string, id: string, data: Partial<Transaction>) {
  const current = await getDoc(txRef(uid, id));
  if (!current.exists()) return null;
  const previous = normalizeTransaction(current.id, current.data());
  if (isProtectedTransaction(previous)) throw new Error('Movimiento protegido: corrige desde su flujo especifico para conservar la contabilidad.');
  const nextType = data.type || previous.type;
  const nextAmount = data.amount ?? previous.amount;
  const nextAccountId = data.accountId || previous.accountId;
  if (!nextAccountId) throw new Error('La correccion necesita una cuenta real.');
  await reverseAccountingTransaction(uid, id, 'Correccion legacy redirigida al motor contable');
  return createAccountingTransaction(uid, {
    type: nextType,
    amount: nextAmount,
    accountId: nextAccountId,
    category: data.category || previous.category,
    description: data.description || `Correccion de ${previous.description}`,
    date: data.date instanceof Date ? data.date : previous.date,
    source: data.source || previous.source || 'manual',
    rawText: data.rawText || previous.rawText || previous.description,
    movementKind: nextType === 'income' ? 'income' : 'expense',
    excludeFromReports: data.excludeFromReports ?? previous.excludeFromReports,
  });
}

export async function deleteTransaction(uid: string, id: string) {
  const current = await getDoc(txRef(uid, id));
  if (!current.exists()) return null;
  const tx = normalizeTransaction(current.id, current.data());
  const deletedRef = await addDoc(deletedTxCol(uid), cleanUndefinedFields({ ...tx, originalId: id, deletedAt: serverTimestamp(), recoverable: true, safeDeletion: true }));
  await reverseAccountingTransaction(uid, id, 'Papelera legacy redirigida a reverso contable');
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
  const restored = normalizeDeletedTransaction(deletedSnap.id, data);
  if (!restored.accountId) throw new Error('No se puede restaurar sin cuenta asociada.');
  const created = await createAccountingTransaction(uid, {
    type: restored.type,
    amount: restored.amount,
    accountId: restored.accountId,
    category: restored.category,
    description: `Restaurado: ${restored.description}`,
    date: restored.date,
    source: restored.source || 'manual',
    rawText: restored.rawText || restored.description,
    movementKind: restored.type === 'income' ? 'income' : 'expense',
    excludeFromReports: restored.excludeFromReports,
  });
  await deleteDoc(deletedTxRef(uid, deletedId));
  const snap = await getDoc(created);
  return snap.exists() ? normalizeTransaction(snap.id, snap.data()) : restored;
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

export async function addDebt(uid: string, data: LegacyDebtInput) {
  const accountId = data.linkedAccountId || (data as any).accountId;
  if (!accountId) throw new Error('Para crear una deuda segura debes indicar la cuenta real que se mueve.');
  const account = await getAccountById(uid, accountId);
  return createDebtWithMoneyMovement(uid, {
    direction: data.direction,
    personName: data.personName,
    amountOriginal: toMoney(data.amountOriginal),
    amountPaid: toMoney(data.amountPaid || 0),
    currency: data.currency || 'COP',
    description: data.description,
    notes: data.notes || null,
    dueDate: data.dueDate || null,
    status: data.status,
    source: data.source || 'manual',
    confidence: data.confidence,
    closedAt: data.closedAt || null,
  }, account);
}

export async function updateDebt(uid: string, id: string, data: Partial<Debt>) {
  if (hasFinancialDebtPatch(data)) throw new Error('Cambio financiero de deuda bloqueado: usa abono, pago total o anulacion segura.');
  const payload: Record<string, unknown> = cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() });
  if (data.dueDate !== undefined) payload.dueDate = data.dueDate ? Timestamp.fromDate(data.dueDate) : null;
  return updateDoc(debtRef(uid, id), cleanUndefinedFields(payload));
}

export async function deleteDebt(uid: string, id: string) {
  return voidDebtWithMoneyMovements(uid, id, 'Papelera legacy redirigida a anulacion segura');
}

export async function registerDebtPayment(uid: string, id: string, amount: number) {
  const current = await getDoc(debtRef(uid, id));
  if (!current.exists()) return null;
  const debt = normalizeDebt(current.id, current.data());
  const accountId = (debt as any).lastPaymentAccountId || (debt as any).linkedAccountId;
  if (!accountId) throw new Error('Para abonar una deuda se necesita la cuenta real que se mueve.');
  const account = await getAccountById(uid, accountId);
  return registerDebtPaymentWithMoneyMovement(uid, id, amount, account);
}

// -- Chat messages -----------------------------------------------------------
export async function getChatMessages(uid: string, limitCount = 50): Promise<ChatMessage[]> {
  const snap = await getDocs(query(chatCol(uid), orderBy('createdAt', 'asc'), limit(limitCount)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toDate(d.data().createdAt) })) as ChatMessage[];
}

export async function addChatMessage(uid: string, data: Omit<ChatMessage, 'id' | 'createdAt'>) {
  return addDoc(chatCol(uid), cleanUndefinedFields({ ...data, createdAt: serverTimestamp() }));
}

// -- Action logs -------------------------------------------------------------
export async function addActionLog(uid: string, data: Omit<ActionLog, 'id' | 'createdAt'>) {
  try {
    return await addDoc(actionLogCol(uid), cleanUndefinedFields({ ...data, createdAt: serverTimestamp() }));
  } catch (error) {
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
  if (!snap.exists()) return { autoCreateTransactions: true, askConfirmationWhenAmbiguous: true, monthlyStartDay: 1 };
  return snap.data() as AppSettings;
}

export async function updateSettings(uid: string, data: Partial<AppSettings>) {
  return setDoc(settRef(uid), cleanUndefinedFields({ ...data, updatedAt: serverTimestamp() }), { merge: true });
}
