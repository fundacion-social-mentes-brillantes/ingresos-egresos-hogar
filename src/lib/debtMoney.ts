import { collection, doc, getDoc, increment, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Account, Debt, DebtDirection } from '../types';

type NewDebtInput = {
  direction: DebtDirection;
  personName: string;
  amountOriginal: number;
  amountPaid?: number;
  currency: 'COP';
  description: string;
  notes?: string | null;
  dueDate?: Date | null;
  status?: 'open' | 'partial' | 'paid';
  source: 'manual' | 'bot';
  confidence?: number;
  closedAt?: Date | null;
};

function debtCol(uid: string) { return collection(db, 'users', uid, 'debts'); }
function txCol(uid: string) { return collection(db, 'users', uid, 'transactions'); }
function debtRef(uid: string, id: string) { return doc(db, 'users', uid, 'debts', id); }
function accRef(uid: string, id: string) { return doc(db, 'users', uid, 'accounts', id); }

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDebt(id: string, data: any): Debt {
  const amountOriginal = Number(data.amountOriginal || 0);
  const amountPaid = Number(data.amountPaid || 0);
  return {
    id,
    ...data,
    amountOriginal,
    amountPaid,
    dueDate: toDate(data.dueDate),
    closedAt: toDate(data.closedAt),
    createdAt: toDate(data.createdAt) || new Date(),
    updatedAt: toDate(data.updatedAt) || new Date(),
  } as Debt;
}

function remaining(debt: Debt): number {
  return Math.max(0, Number(debt.amountOriginal || 0) - Number(debt.amountPaid || 0));
}

export async function createDebtWithMoneyMovement(uid: string, data: NewDebtInput, account: Account) {
  if (!account?.id) throw new Error('Elige la cuenta para mover la plata.');
  const amountOriginal = Number(data.amountOriginal || 0);
  if (!amountOriginal || amountOriginal <= 0) throw new Error('El valor debe ser mayor que cero.');

  const isReceivable = data.direction === 'receivable';
  const debt = doc(debtCol(uid));
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  const status = data.status || ((data.amountPaid || 0) >= amountOriginal ? 'paid' : (data.amountPaid || 0) > 0 ? 'partial' : 'open');
  const description = data.description || (isReceivable ? 'Plata prestada' : 'Deuda por pagar');

  batch.set(debt, {
    ...data,
    amountOriginal,
    amountPaid: Number(data.amountPaid || 0),
    status,
    dueDate: data.dueDate ? Timestamp.fromDate(data.dueDate) : null,
    closedAt: status === 'paid' ? serverTimestamp() : null,
    linkedAccountId: account.id,
    linkedAccountName: account.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(tx, {
    type: isReceivable ? 'expense' : 'income',
    amount: amountOriginal,
    currency: 'COP',
    category: isReceivable ? 'Prestamo entregado' : 'Prestamo recibido',
    accountId: account.id,
    accountName: account.name,
    description: isReceivable ? `Prestamo a ${data.personName}: ${description}` : `Prestamo de ${data.personName}: ${description}`,
    date: Timestamp.fromDate(new Date()),
    rawText: description,
    source: data.source,
    confidence: data.confidence ?? 1,
    debtId: debt.id,
    debtMovementKind: isReceivable ? 'loan_principal_out' : 'loan_principal_in',
    excludeFromReports: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(accRef(uid, account.id), {
    currentBalance: increment(isReceivable ? -amountOriginal : amountOriginal),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return debt;
}

export async function registerDebtPaymentWithMoneyMovement(uid: string, debtId: string, amount: number, account: Account) {
  if (!account?.id) throw new Error('Elige la cuenta para mover la plata.');
  const snap = await getDoc(debtRef(uid, debtId));
  if (!snap.exists()) throw new Error('No encontre la deuda.');
  const debt = normalizeDebt(snap.id, snap.data());
  const applied = Math.min(remaining(debt), Number(amount || 0));
  if (!applied || applied <= 0) throw new Error('El abono debe ser mayor que cero.');

  const isReceivable = debt.direction === 'receivable';
  const newPaid = Math.min(debt.amountOriginal, debt.amountPaid + applied);
  const newStatus = newPaid >= debt.amountOriginal ? 'paid' : newPaid > 0 ? 'partial' : 'open';
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  const description = isReceivable ? `Abono recibido de ${debt.personName}: ${debt.description}` : `Pago de deuda a ${debt.personName}: ${debt.description}`;

  batch.update(debtRef(uid, debt.id), {
    amountPaid: newPaid,
    status: newStatus,
    closedAt: newStatus === 'paid' ? serverTimestamp() : null,
    lastPaymentAccountId: account.id,
    lastPaymentAccountName: account.name,
    updatedAt: serverTimestamp(),
  });

  batch.set(tx, {
    type: isReceivable ? 'income' : 'expense',
    amount: applied,
    currency: 'COP',
    category: isReceivable ? 'Pago deuda recibida' : 'Pago deuda pagada',
    accountId: account.id,
    accountName: account.name,
    description,
    date: Timestamp.fromDate(new Date()),
    rawText: description,
    source: 'manual',
    confidence: 1,
    debtId: debt.id,
    debtMovementKind: isReceivable ? 'debt_payment_in' : 'debt_payment_out',
    excludeFromReports: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(accRef(uid, account.id), {
    currentBalance: increment(isReceivable ? applied : -applied),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return tx;
}
