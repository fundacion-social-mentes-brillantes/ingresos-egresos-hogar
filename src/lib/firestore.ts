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
  startAfter,
  where,
  increment,
  Timestamp,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { createAccountingTransaction, reverseAccountingTransaction } from './accountingOperations';
import { transferBetweenAccountsSafe } from './transferOperations';
import { createDebtWithMoneyMovement, registerDebtPaymentWithMoneyMovement, voidDebtWithMoneyMovements } from './debtMoney';
import { genericReversalBlockReason, inferMovementKind, isProtectedTransaction, toMoney } from './accounting';
import type {
  Transaction,
  Account,
  ChatMessage,
  ChatThread,
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
  // Un lote fija el saldo de la cuenta de forma absoluta, asi que solo tiene
  // sentido sobre una cuenta NUEVA. Si ya existe una con ese nombre, abortamos
  // para no pisar saldos ni movimientos previos (antes el update los borraba).
  if (duplicate) throw new Error(`Ya existe una cuenta llamada "${duplicate.name}". Para importar este lote usa un nombre de cuenta nuevo y unico; asi no se sobreescribe ningun saldo existente.`);

  const batch = writeBatch(db);
  const targetAccountRef = doc(accCol(uid));
  const batchImportId = targetAccountRef.id;
  const importedAt = new Date();
  const initialBalance = toMoney(preview.totalValue || 0);
  const currentBalance = toMoney(preview.expectedPendingBalance || 0);

  batch.set(targetAccountRef, cleanUndefinedFields({ name: accountName, type: 'other' as const, initialBalance, currentBalance, calculatedBalance: currentBalance, active: true, batchImportId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));

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
  return { accountId: targetAccountRef.id, accountName, count: preview.movements.length };
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

// Carga TODOS los movimientos paginando, para que los calculos de saldo y
// conciliacion usen el historial completo y no solo los mas recientes. Un
// listener con limit(500) servia para listar, pero recalcular el saldo sobre
// un set truncado generaba descuadres falsos en cuentas con mucho historial.
export async function getAllTransactions(uid: string): Promise<Transaction[]> {
  const pageSize = 500;
  const out: Transaction[] = [];
  let cursor: any = null;
  for (;;) {
    const page = cursor
      ? query(txCol(uid), orderBy('date', 'desc'), startAfter(cursor), limit(pageSize))
      : query(txCol(uid), orderBy('date', 'desc'), limit(pageSize));
    const snap = await getDocs(page);
    snap.docs.forEach((d) => out.push(normalizeTransaction(d.id, d.data())));
    if (snap.docs.length < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

// Importacion de archivo Excel/CSV de forma ATOMICA y en lote: en vez de un
// commit por fila (que dejaba importaciones a medias si algo fallaba y permitia
// duplicar al re-confirmar), escribe los movimientos y ajusta el saldo de cada
// cuenta en lotes de hasta 400 operaciones. Cada chunk entra completo o no entra.
// Firma determinista del contenido del archivo (cuenta+tipo+monto+fecha+desc por
// fila). Permite detectar que el MISMO archivo ya se importo aunque sea en otra
// sesion o dispositivo, y bloquear la re-importacion que duplicaria el dinero.
function hashFileImport(rows: Array<{ accountId?: string; type?: string; amount: number; date: unknown; description?: string }>): string {
  const canon = rows
    .map((d) => `${d.accountId}|${d.type}|${d.amount}|${(d.date instanceof Date ? d.date : toDate(d.date)).getTime()}|${d.description || ''}`)
    .join('\n');
  let h = 5381;
  for (let i = 0; i < canon.length; i += 1) h = ((h << 5) + h + canon.charCodeAt(i)) | 0;
  return `imp_${(h >>> 0).toString(36)}_${rows.length}`;
}

export async function createFileImportTransactions(uid: string, drafts: LegacyTransactionInput[]) {
  const valid = drafts
    .map((draft) => ({ ...draft, amount: toMoney(draft.amount) }))
    .filter((draft) => draft.accountId && draft.amount > 0 && (draft.type === 'income' || draft.type === 'expense'));
  if (valid.length === 0) throw new Error('No hay movimientos validos para importar.');

  const fileImportId = hashFileImport(valid);
  // Anti-duplicado entre sesiones: si ya existe un movimiento con esta firma,
  // este archivo ya se importo. No se vuelve a guardar.
  const yaImportado = await getDocs(query(txCol(uid), where('fileImportId', '==', fileImportId), limit(1)));
  if (!yaImportado.empty) throw new Error('Estos mismos movimientos ya fueron importados antes desde un archivo. No se volvieron a guardar para no duplicar el dinero.');

  const chunkSize = 400;
  let saved = 0;

  for (let start = 0; start < valid.length; start += chunkSize) {
    const chunk = valid.slice(start, start + chunkSize);
    const batch = writeBatch(db);
    const deltaByAccount = new Map<string, number>();

    chunk.forEach((draft, indexInChunk) => {
      const movementKind = draft.type === 'income' ? 'income' : 'expense';
      const newTxRef = doc(txCol(uid));
      batch.set(newTxRef, cleanUndefinedFields({
        type: draft.type,
        amount: draft.amount,
        currency: 'COP' as const,
        category: draft.category || (draft.type === 'income' ? 'Ingreso' : 'Otros'),
        accountId: draft.accountId,
        accountName: draft.accountName,
        description: draft.description || 'Movimiento importado',
        date: draft.date instanceof Date ? Timestamp.fromDate(draft.date) : Timestamp.fromDate(toDate(draft.date)),
        rawText: draft.rawText || draft.description || '',
        source: 'manual' as const,
        confidence: draft.confidence ?? 1,
        movementKind,
        affectsCash: true,
        affectsReport: true,
        affectsDebt: false,
        excludeFromReports: false,
        fileImportId,
        importRow: start + indexInChunk + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      const delta = draft.type === 'income' ? draft.amount : -draft.amount;
      deltaByAccount.set(draft.accountId, (deltaByAccount.get(draft.accountId) || 0) + delta);
    });

    deltaByAccount.forEach((delta, accountId) => {
      if (delta !== 0) batch.update(accRef(uid, accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
    });
    batch.set(doc(actionLogCol(uid)), cleanUndefinedFields({ action: 'import_excel_file', entityType: 'transaction', description: `Importacion de archivo: ${chunk.length} movimientos`, after: { fileImportId, count: chunk.length }, source: 'manual', status: 'executed', createdAt: serverTimestamp() }));

    try {
      await batch.commit();
    } catch (error) {
      // Para archivos grandes (multiples chunks) un chunk previo pudo entrar.
      // Avisamos con cuanto se guardo para que el usuario no reimporte a ciegas.
      if (saved > 0) throw new Error(`Se alcanzaron a guardar ${saved} de ${valid.length} movimientos y luego fallo (red o permisos). Revisa el saldo de la cuenta antes de reintentar para no duplicar.`);
      throw error;
    }
    saved += chunk.length;
  }

  return { count: saved, skipped: drafts.length - valid.length, fileImportId };
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
  const blockReason = genericReversalBlockReason(previous);
  if (blockReason || isProtectedTransaction(previous)) throw new Error(blockReason || 'Movimiento protegido: corrige desde su flujo especifico para conservar la contabilidad.');
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
  const blockReason = genericReversalBlockReason(tx);
  if (blockReason || isProtectedTransaction(tx)) throw new Error(blockReason || 'Movimiento protegido: usa su flujo seguro para conservar la contabilidad.');
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
    movementKind: safeMovementKind(restored),
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

// -- Chat conversations (hilos tipo ChatGPT/Claude) --------------------------
// La lista de conversaciones se guarda en un doc de settings (que ya tiene
// permisos), evitando una coleccion nueva que requeriria cambiar reglas.
const chatThreadsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'chatThreads');

export async function getChatThreads(uid: string): Promise<{ threads: ChatThread[]; activeId: string | null }> {
  const snap = await getDoc(chatThreadsRef(uid));
  if (!snap.exists()) return { threads: [], activeId: null };
  const data = snap.data() as Record<string, unknown>;
  const threads = (Array.isArray(data.threads) ? data.threads : []) as ChatThread[];
  const activeId = (typeof data.activeId === 'string' ? data.activeId : null) ?? (threads[0]?.id ?? null);
  return { threads, activeId };
}

export async function saveChatThreads(uid: string, value: { threads: ChatThread[]; activeId: string | null }) {
  return setDoc(chatThreadsRef(uid), cleanUndefinedFields({ threads: value.threads, activeId: value.activeId, updatedAt: serverTimestamp() }), { merge: true });
}

// Asigna los mensajes antiguos (sin conversationId) al hilo indicado, para que
// el historial previo a esta funcion no quede huerfano e invisible.
export async function assignOrphanMessagesToThread(uid: string, conversationId: string) {
  if (!conversationId) return;
  const snap = await getDocs(query(chatCol(uid), limit(500)));
  const orphans = snap.docs.filter((d) => !(d.data() as Record<string, unknown>).conversationId);
  if (orphans.length === 0) return;
  let batch = writeBatch(db);
  let count = 0;
  for (const docSnap of orphans) {
    batch.update(docSnap.ref, { conversationId });
    count += 1;
    if (count % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
}

// Borra todos los mensajes de una conversacion (en lotes para no pasar el limite).
export async function deleteConversationMessages(uid: string, conversationId: string) {
  if (!conversationId) return;
  const snap = await getDocs(query(chatCol(uid), where('conversationId', '==', conversationId)));
  if (snap.empty) return;
  let batch = writeBatch(db);
  let count = 0;
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    count += 1;
    if (count % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
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
