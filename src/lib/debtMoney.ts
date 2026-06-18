import { collection, doc, getDoc, getDocs, increment, query, runTransaction, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Account, Debt, DebtDirection } from '../types';
import { affectsCash, toMoney } from './accounting';

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
function auditCol(uid: string) { return collection(db, 'users', uid, 'accountingAudit'); }
function debtRef(uid: string, id: string) { return doc(db, 'users', uid, 'debts', id); }
function txRef(uid: string, id: string) { return doc(db, 'users', uid, 'transactions', id); }
function accRef(uid: string, id: string) { return doc(db, 'users', uid, 'accounts', id); }

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDebt(id: string, data: any): Debt {
  const amountOriginal = toMoney(data.amountOriginal || 0);
  const amountPaid = toMoney(data.amountPaid || 0);
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
  return Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid));
}

function cashDelta(tx: any): number {
  if (!affectsCash(tx)) return 0;
  return tx.type === 'income' ? toMoney(tx.amount) : -toMoney(tx.amount);
}

export async function createDebtWithMoneyMovement(uid: string, data: NewDebtInput, account: Account) {
  if (!account?.id) throw new Error('Elige la cuenta para mover la plata.');
  const amountOriginal = toMoney(data.amountOriginal || 0);
  if (!amountOriginal || amountOriginal <= 0) throw new Error('El valor debe ser mayor que cero.');

  const isReceivable = data.direction === 'receivable';
  const debt = doc(debtCol(uid));
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  const paid = toMoney(data.amountPaid || 0);
  const status = data.status || (paid >= amountOriginal ? 'paid' : paid > 0 ? 'partial' : 'open');
  const description = data.description || (isReceivable ? 'Plata prestada' : 'Deuda por pagar');
  const type = isReceivable ? 'expense' : 'income';
  const movementKind = isReceivable ? 'loan_given' : 'loan_received';
  const delta = isReceivable ? -amountOriginal : amountOriginal;

  batch.set(debt, {
    ...data,
    amountOriginal,
    amountPaid: paid,
    status,
    dueDate: data.dueDate ? Timestamp.fromDate(data.dueDate) : null,
    closedAt: status === 'paid' ? serverTimestamp() : null,
    debtKind: 'loan',
    linkedAccountId: account.id,
    linkedAccountName: account.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(tx, {
    type,
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
    movementKind,
    affectsCash: true,
    affectsReport: false,
    affectsDebt: true,
    excludeFromReports: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(accRef(uid, account.id), {
    currentBalance: increment(delta),
    calculatedBalance: increment(delta),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(auditCol(uid)), { action: 'create_debt_with_money_movement', debtId: debt.id, transactionId: tx.id, amount: amountOriginal, delta, createdAt: serverTimestamp() });

  await batch.commit();
  return debt;
}

export async function registerDebtPaymentWithMoneyMovement(uid: string, debtId: string, amount: number, account: Account) {
  if (!account?.id) throw new Error('Elige la cuenta para mover la plata.');
  const requested = toMoney(amount || 0);
  if (requested <= 0) throw new Error('El abono debe ser mayor que cero.');
  const tx = doc(txCol(uid));
  const auditDoc = doc(auditCol(uid));
  const fechaTs = Timestamp.fromDate(new Date());

  // runTransaction (no writeBatch): la lectura de la deuda y la escritura de
  // amountPaid quedan atomicas, asi dos abonos simultaneos no se pisan.
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(debtRef(uid, debtId));
    if (!snap.exists()) throw new Error('No encontre la deuda.');
    const debt = normalizeDebt(snap.id, snap.data());
    const applied = Math.min(remaining(debt), requested);
    if (applied <= 0) throw new Error('Esta deuda ya esta saldada.');

    const isReceivable = debt.direction === 'receivable';
    const newPaid = Math.min(debt.amountOriginal, debt.amountPaid + applied);
    const newStatus = newPaid >= debt.amountOriginal ? 'paid' : newPaid > 0 ? 'partial' : 'open';
    const description = isReceivable ? `Abono recibido de ${debt.personName}: ${debt.description}` : `Pago de deuda a ${debt.personName}: ${debt.description}`;
    const type = isReceivable ? 'income' : 'expense';
    const movementKind = isReceivable ? 'loan_payment_received' : 'debt_payment_made';
    const delta = isReceivable ? applied : -applied;

    transaction.update(debtRef(uid, debt.id), {
      amountPaid: newPaid,
      status: newStatus,
      closedAt: newStatus === 'paid' ? serverTimestamp() : null,
      lastPaymentAccountId: account.id,
      lastPaymentAccountName: account.name,
      updatedAt: serverTimestamp(),
    });

    transaction.set(tx, {
      type,
      amount: applied,
      currency: 'COP',
      category: isReceivable ? 'Pago deuda recibida' : 'Pago deuda pagada',
      accountId: account.id,
      accountName: account.name,
      description,
      date: fechaTs,
      rawText: description,
      source: 'manual',
      confidence: 1,
      debtId: debt.id,
      debtMovementKind: isReceivable ? 'debt_payment_in' : 'debt_payment_out',
      movementKind,
      affectsCash: true,
      affectsReport: false,
      affectsDebt: true,
      excludeFromReports: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(accRef(uid, account.id), {
      currentBalance: increment(delta),
      calculatedBalance: increment(delta),
      updatedAt: serverTimestamp(),
    });
    transaction.set(auditDoc, { action: 'register_debt_payment_with_money_movement', debtId: debt.id, transactionId: tx.id, amount: applied, delta, createdAt: serverTimestamp() });
  });

  return tx;
}

export async function voidDebtWithMoneyMovements(uid: string, debtId: string, reason = 'Anulacion de deuda') {
  const snap = await getDoc(debtRef(uid, debtId));
  if (!snap.exists()) throw new Error('No encontre la deuda.');
  const debt = normalizeDebt(snap.id, snap.data());
  if (debt.isReversed) throw new Error('Esta deuda ya fue anulada.');

  const txSnap = await getDocs(query(txCol(uid), where('debtId', '==', debtId)));
  const batch = writeBatch(db);

  txSnap.docs.forEach((item) => {
    const tx = { id: item.id, ...item.data() } as any;
    if (tx.isReversed || tx.reversalOf) return;
    const amount = toMoney(tx.amount || 0);
    const reverseType = tx.type === 'income' ? 'expense' : 'income';
    const delta = -cashDelta(tx);
    const reverse = doc(txCol(uid));
    batch.update(txRef(uid, tx.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
    batch.set(reverse, {
      type: reverseType,
      amount,
      currency: 'COP',
      category: 'Reverso deuda',
      accountId: tx.accountId,
      accountName: tx.accountName,
      description: `Reverso de deuda: ${tx.description}`,
      date: serverTimestamp(),
      rawText: reason,
      source: 'manual',
      confidence: 1,
      debtId,
      movementKind: 'reconciliation_adjustment',
      affectsCash: affectsCash(tx),
      affectsReport: false,
      affectsDebt: true,
      excludeFromReports: true,
      reversalOf: tx.id,
      reversalReason: reason,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (tx.accountId && delta !== 0) {
      batch.update(accRef(uid, tx.accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
    }
  });

  batch.update(debtRef(uid, debtId), { isReversed: true, status: 'paid', amountPaid: toMoney(debt.amountOriginal), reversalReason: reason, closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(auditCol(uid)), { action: 'void_debt_with_money_movements', debtId, reason, createdAt: serverTimestamp() });
  await batch.commit();
}
