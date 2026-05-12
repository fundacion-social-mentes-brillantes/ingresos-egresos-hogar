import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Account, Debt, MovementKind, Transaction, TransactionType } from '../types';
import {
  affectsCash,
  calculateReconciliation,
  inferMovementKind,
  isProtectedTransaction,
  moneyEffect,
  parseCurrencyInput,
  toMoney,
} from './accounting';

const txCol = (uid: string) => collection(db, 'users', uid, 'transactions');
const txRef = (uid: string, id: string) => doc(db, 'users', uid, 'transactions', id);
const accRef = (uid: string, id: string) => doc(db, 'users', uid, 'accounts', id);
const debtRef = (uid: string, id: string) => doc(db, 'users', uid, 'debts', id);
const auditCol = (uid: string) => collection(db, 'users', uid, 'accountingAudit');

function ts(value?: Date | null) {
  return value ? Timestamp.fromDate(value) : serverTimestamp();
}

function normalizeAmount(value: unknown): number {
  if (typeof value === 'number') return toMoney(value);
  return parseCurrencyInput(value);
}

async function getAccount(uid: string, accountId: string): Promise<Account> {
  const snap = await getDoc(accRef(uid, accountId));
  if (!snap.exists()) throw new Error('La cuenta no existe.');
  return { id: snap.id, ...snap.data() } as Account;
}

async function getTransaction(uid: string, id: string): Promise<Transaction> {
  const snap = await getDoc(txRef(uid, id));
  if (!snap.exists()) throw new Error('El movimiento no existe.');
  const data = snap.data() as Record<string, any>;
  return {
    id: snap.id,
    ...data,
    amount: toMoney(data.amount),
    date: typeof data.date?.toDate === 'function' ? data.date.toDate() : new Date(data.date || Date.now()),
    createdAt: typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate() : new Date(),
    updatedAt: typeof data.updatedAt?.toDate === 'function' ? data.updatedAt.toDate() : new Date(),
  } as Transaction;
}

function cashDelta(tx: Partial<Transaction> & { amount: number; type: TransactionType }): number {
  return affectsCash(tx) ? moneyEffect(tx as Transaction) : 0;
}

export async function confirmRealBalance(uid: string, accountId: string, realBalanceInput: unknown) {
  const realBalance = normalizeAmount(realBalanceInput);
  const account = await getAccount(uid, accountId);
  const calculatedBalance = toMoney(account.calculatedBalance ?? account.currentBalance ?? account.initialBalance ?? 0);
  const reconciliation = calculateReconciliation(calculatedBalance, realBalance);
  await runTransaction(db, async (transaction) => {
    transaction.update(accRef(uid, accountId), {
      realBalance,
      lastReconciledBalance: realBalance,
      lastReconciledAt: serverTimestamp(),
      reconciliationDifference: reconciliation.diferencia,
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(auditCol(uid)), {
      action: 'confirm_real_balance',
      accountId,
      accountName: account.name,
      calculatedBalance,
      realBalance,
      difference: reconciliation.diferencia,
      createdAt: serverTimestamp(),
    });
  });
  return reconciliation;
}

export async function createAccountingTransaction(uid: string, input: {
  type: TransactionType;
  amount: unknown;
  accountId: string;
  category: string;
  description: string;
  date?: Date;
  source?: 'manual' | 'bot';
  rawText?: string;
  movementKind?: MovementKind;
  affectsReport?: boolean;
  affectsDebt?: boolean;
  debtId?: string;
  excludeFromReports?: boolean;
}) {
  const amount = normalizeAmount(input.amount);
  if (amount <= 0) throw new Error('El valor debe ser mayor que cero.');
  const account = await getAccount(uid, input.accountId);
  const movementKind = input.movementKind || (input.type === 'income' ? 'income' : 'expense');
  const excludeFromReports = input.excludeFromReports ?? !['income', 'expense', 'payable_expense_created'].includes(movementKind);
  const payload = {
    type: input.type,
    amount,
    currency: 'COP' as const,
    category: input.category || (input.type === 'income' ? 'Ingreso' : 'Otros'),
    accountId: account.id,
    accountName: account.name,
    description: input.description || 'Movimiento contable',
    date: ts(input.date),
    rawText: input.rawText || input.description || '',
    source: input.source || 'manual',
    confidence: 1,
    movementKind,
    affectsCash: !['payable_expense_created', 'receivable_created', 'opening_balance'].includes(movementKind),
    affectsReport: input.affectsReport ?? ['income', 'expense', 'payable_expense_created'].includes(movementKind),
    affectsDebt: input.affectsDebt ?? Boolean(input.debtId),
    debtId: input.debtId || null,
    excludeFromReports,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const delta = cashDelta({ ...payload, amount, type: input.type } as any);
  const newTx = doc(txCol(uid));
  const batch = writeBatch(db);
  batch.set(newTx, payload);
  if (delta !== 0) {
    batch.update(accRef(uid, account.id), {
      currentBalance: increment(delta),
      calculatedBalance: increment(delta),
      updatedAt: serverTimestamp(),
    });
  }
  batch.set(doc(auditCol(uid)), {
    action: 'create_accounting_transaction',
    transactionId: newTx.id,
    accountId: account.id,
    amount,
    movementKind,
    delta,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return newTx;
}

export async function reverseAccountingTransaction(uid: string, transactionId: string, reason = 'Anulacion contable') {
  const original = await getTransaction(uid, transactionId);
  if (original.isReversed) throw new Error('Este movimiento ya fue reversado.');
  const amount = toMoney(original.amount);
  const reverseType: TransactionType = original.type === 'income' ? 'expense' : 'income';
  const reverseRef = doc(txCol(uid));
  const reversePayload = {
    type: reverseType,
    amount,
    currency: 'COP' as const,
    category: 'Reverso contable',
    accountId: original.accountId,
    accountName: original.accountName,
    description: `Reverso de: ${original.description}`,
    date: serverTimestamp(),
    rawText: reason,
    source: 'manual' as const,
    confidence: 1,
    movementKind: 'reconciliation_adjustment' as const,
    affectsCash: affectsCash(original),
    affectsReport: false,
    affectsDebt: false,
    excludeFromReports: true,
    reversalOf: original.id,
    reversalReason: reason,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const delta = affectsCash(original) ? (original.type === 'income' ? -amount : amount) : 0;
  const batch = writeBatch(db);
  batch.update(txRef(uid, original.id), {
    isReversed: true,
    reversedAt: serverTimestamp(),
    reversalReason: reason,
    updatedAt: serverTimestamp(),
  });
  batch.set(reverseRef, reversePayload);
  if (delta !== 0 && original.accountId) {
    batch.update(accRef(uid, original.accountId), {
      currentBalance: increment(delta),
      calculatedBalance: increment(delta),
      updatedAt: serverTimestamp(),
    });
  }
  batch.set(doc(auditCol(uid)), {
    action: 'reverse_transaction',
    transactionId: original.id,
    reverseTransactionId: reverseRef.id,
    reason,
    delta,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return reverseRef;
}

export async function validateTransferIntegrity(uid: string, transferId: string) {
  const snap = await getDocs(query(txCol(uid), where('transferId', '==', transferId)));
  const items = snap.docs.map((item) => ({ id: item.id, ...item.data() } as Transaction));
  const out = items.filter((tx) => inferMovementKind(tx) === 'transfer_out');
  const input = items.filter((tx) => inferMovementKind(tx) === 'transfer_in');
  const valid = items.length === 2 && out.length === 1 && input.length === 1 && toMoney(out[0].amount) === toMoney(input[0].amount);
  return { valid, items, message: valid ? 'Transferencia integra' : 'Transferencia rota o incompleta' };
}

export async function reverseTransfer(uid: string, transferId: string, reason = 'Anulacion de transferencia') {
  const integrity = await validateTransferIntegrity(uid, transferId);
  if (!integrity.valid) throw new Error(integrity.message);
  for (const tx of integrity.items) {
    await reverseAccountingTransaction(uid, tx.id, reason);
  }
}

export async function createPayableExpense(uid: string, input: {
  accountId: string;
  personName: string;
  amount: unknown;
  description: string;
  category?: string;
  dueDate?: Date | null;
}) {
  const amount = normalizeAmount(input.amount);
  if (amount <= 0) throw new Error('El valor debe ser mayor que cero.');
  const account = await getAccount(uid, input.accountId);
  const debt = doc(collection(db, 'users', uid, 'debts'));
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  batch.set(debt, {
    direction: 'payable',
    personName: input.personName,
    amountOriginal: amount,
    amountPaid: 0,
    currency: 'COP',
    description: input.description,
    dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null,
    status: 'open',
    source: 'manual',
    debtKind: 'payable_expense',
    linkedAccountId: account.id,
    linkedAccountName: account.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(tx, {
    type: 'expense',
    amount,
    currency: 'COP',
    category: input.category || 'Otros',
    accountId: account.id,
    accountName: account.name,
    description: `Gasto pendiente: ${input.description}`,
    date: serverTimestamp(),
    rawText: input.description,
    source: 'manual',
    confidence: 1,
    movementKind: 'payable_expense_created',
    affectsCash: false,
    affectsReport: true,
    affectsDebt: true,
    debtId: debt.id,
    excludeFromReports: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return { debt, transaction: tx };
}

export async function payPayableExpense(uid: string, debtId: string, amountInput: unknown, account: Account) {
  const amount = normalizeAmount(amountInput);
  if (amount <= 0) throw new Error('El abono debe ser mayor que cero.');
  const snap = await getDoc(debtRef(uid, debtId));
  if (!snap.exists()) throw new Error('La deuda no existe.');
  const debt = { id: snap.id, ...snap.data() } as Debt;
  if (debt.direction !== 'payable') throw new Error('Solo se pueden pagar cuentas por pagar.');
  const applied = Math.min(amount, Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid)));
  const newPaid = toMoney(debt.amountPaid) + applied;
  const newStatus = newPaid >= toMoney(debt.amountOriginal) ? 'paid' : 'partial';
  const tx = await createAccountingTransaction(uid, {
    type: 'expense',
    amount: applied,
    accountId: account.id,
    category: 'Pago gasto pendiente',
    description: `Pago de gasto pendiente: ${debt.description}`,
    movementKind: 'payable_expense_paid',
    affectsReport: false,
    affectsDebt: true,
    debtId,
    excludeFromReports: true,
  });
  await runTransaction(db, async (transaction) => {
    transaction.update(debtRef(uid, debtId), {
      amountPaid: newPaid,
      status: newStatus,
      closedAt: newStatus === 'paid' ? serverTimestamp() : null,
      lastPaymentAccountId: account.id,
      lastPaymentAccountName: account.name,
      updatedAt: serverTimestamp(),
    });
  });
  return tx;
}

export function assertSafeManualMutation(tx: Partial<Transaction>) {
  if (isProtectedTransaction(tx)) {
    throw new Error('Movimiento protegido: usa reverso contable para conservar trazabilidad.');
  }
}
