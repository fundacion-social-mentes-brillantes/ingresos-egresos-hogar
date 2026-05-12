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
  summarizeAccount,
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

function toDate(value: any): Date {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function getAccount(uid: string, accountId: string): Promise<Account> {
  const snap = await getDoc(accRef(uid, accountId));
  if (!snap.exists()) throw new Error('La cuenta no existe.');
  return { id: snap.id, ...snap.data(), currentBalance: toMoney((snap.data() as any).currentBalance), initialBalance: toMoney((snap.data() as any).initialBalance), createdAt: toDate((snap.data() as any).createdAt) } as Account;
}

async function getTransaction(uid: string, id: string): Promise<Transaction> {
  const snap = await getDoc(txRef(uid, id));
  if (!snap.exists()) throw new Error('El movimiento no existe.');
  const data = snap.data() as Record<string, any>;
  return { id: snap.id, ...data, amount: toMoney(data.amount), date: toDate(data.date), createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as Transaction;
}

async function getTransactionsForAccount(uid: string, account: Account): Promise<Transaction[]> {
  const byId = await getDocs(query(txCol(uid), where('accountId', '==', account.id)));
  return byId.docs.map((item) => {
    const data = item.data() as Record<string, any>;
    return { id: item.id, ...data, amount: toMoney(data.amount), date: toDate(data.date), createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as Transaction;
  });
}

function cashDelta(tx: Partial<Transaction> & { amount: number; type: TransactionType }): number {
  return affectsCash(tx) ? moneyEffect(tx as Transaction) : 0;
}

export function genericReversalBlockReason(tx: Partial<Transaction>): string | null {
  const kind = inferMovementKind(tx);
  if (tx.isReversed) return 'Este movimiento ya fue reversado.';
  if (tx.reversalOf) return 'Un reverso no se reversa directamente. Corrige creando el movimiento correcto.';
  if (tx.transferId || kind === 'transfer_in' || kind === 'transfer_out') return 'Movimiento de transferencia protegido: usa reverseTransfer para reversar las dos patas completas.';
  if (tx.debtId || tx.debtMovementKind || ['loan_given', 'loan_received', 'loan_payment_received', 'debt_payment_made', 'payable_expense_created', 'payable_expense_paid', 'receivable_created'].includes(kind)) return 'Movimiento de deuda protegido: usa el flujo de Deudas para abonar, corregir o anular sin descuadrar.';
  if (tx.batchImportId || kind === 'historical_non_reportable') return 'Movimiento historico/importado protegido: no se reversa como gasto o ingreso normal.';
  return null;
}

export async function confirmRealBalance(uid: string, accountId: string, realBalanceInput: unknown) {
  const realBalance = normalizeAmount(realBalanceInput);
  const account = await getAccount(uid, accountId);
  const txs = await getTransactionsForAccount(uid, account);
  const summary = summarizeAccount(account, txs);
  const calculatedBalance = summary.saldoFisicoCalculado;
  const reconciliation = calculateReconciliation(calculatedBalance, realBalance);

  await runTransaction(db, async (transaction) => {
    transaction.update(accRef(uid, accountId), {
      realBalance,
      lastReconciledBalance: realBalance,
      lastReconciledAt: serverTimestamp(),
      calculatedBalance,
      reconciliationDifference: reconciliation.diferencia,
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(auditCol(uid)), {
      action: 'confirm_real_balance_from_ledger',
      accountId,
      accountName: account.name,
      calculatedBalance,
      realBalance,
      difference: reconciliation.diferencia,
      source: 'ledger_recalculation',
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
  if (delta !== 0) batch.update(accRef(uid, account.id), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
  batch.set(doc(auditCol(uid)), { action: 'create_accounting_transaction', transactionId: newTx.id, accountId: account.id, amount, movementKind, delta, createdAt: serverTimestamp() });
  await batch.commit();
  return newTx;
}

export async function reverseAccountingTransaction(uid: string, transactionId: string, reason = 'Anulacion contable') {
  const original = await getTransaction(uid, transactionId);
  const blockReason = genericReversalBlockReason(original);
  if (blockReason) throw new Error(blockReason);
  if (isProtectedTransaction(original)) throw new Error('Movimiento protegido: usa su flujo especifico para conservar la contabilidad.');
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
  batch.update(txRef(uid, original.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
  batch.set(reverseRef, reversePayload);
  if (delta !== 0 && original.accountId) batch.update(accRef(uid, original.accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
  batch.set(doc(auditCol(uid)), { action: 'reverse_transaction', transactionId: original.id, reverseTransactionId: reverseRef.id, reason, delta, createdAt: serverTimestamp() });
  await batch.commit();
  return reverseRef;
}

export async function validateTransferIntegrity(uid: string, transferId: string) {
  const snap = await getDocs(query(txCol(uid), where('transferId', '==', transferId)));
  const items = snap.docs.map((item) => ({ id: item.id, ...item.data() } as Transaction));
  const out = items.filter((tx) => inferMovementKind(tx) === 'transfer_out');
  const input = items.filter((tx) => inferMovementKind(tx) === 'transfer_in');
  const valid = items.length === 2 && out.length === 1 && input.length === 1 && toMoney(out[0].amount) === toMoney(input[0].amount) && !items.some((tx) => tx.isReversed || tx.reversalOf);
  return { valid, items, message: valid ? 'Transferencia integra' : 'Transferencia rota, incompleta o ya reversada' };
}

export async function reverseTransfer(uid: string, transferId: string, reason = 'Anulacion de transferencia') {
  const integrity = await validateTransferIntegrity(uid, transferId);
  if (!integrity.valid) throw new Error(integrity.message);
  const batch = writeBatch(db);
  for (const item of integrity.items) {
    const tx = await getTransaction(uid, item.id);
    const amount = toMoney(tx.amount);
    const reverseType: TransactionType = tx.type === 'income' ? 'expense' : 'income';
    const delta = tx.type === 'income' ? -amount : amount;
    const reverseRef = doc(txCol(uid));
    batch.update(txRef(uid, tx.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
    batch.set(reverseRef, {
      type: reverseType,
      amount,
      currency: 'COP',
      category: 'Reverso transferencia',
      accountId: tx.accountId,
      accountName: tx.accountName,
      description: `Reverso transferencia: ${tx.description}`,
      date: serverTimestamp(),
      rawText: reason,
      source: 'manual',
      confidence: 1,
      movementKind: 'reconciliation_adjustment',
      affectsCash: true,
      affectsReport: false,
      affectsDebt: false,
      excludeFromReports: true,
      reversalOf: tx.id,
      transferId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(accRef(uid, tx.accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
  }
  batch.set(doc(auditCol(uid)), { action: 'reverse_transfer', transferId, reason, createdAt: serverTimestamp() });
  await batch.commit();
}

export async function createPayableExpense(uid: string, input: { accountId: string; personName: string; amount: unknown; description: string; category?: string; dueDate?: Date | null; }) {
  const amount = normalizeAmount(input.amount);
  if (amount <= 0) throw new Error('El valor debe ser mayor que cero.');
  const account = await getAccount(uid, input.accountId);
  const debt = doc(collection(db, 'users', uid, 'debts'));
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  batch.set(debt, {
    direction: 'payable', personName: input.personName, amountOriginal: amount, amountPaid: 0, currency: 'COP', description: input.description,
    dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null, status: 'open', source: 'manual', debtKind: 'payable_expense', linkedAccountId: account.id, linkedAccountName: account.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(tx, {
    type: 'expense', amount, currency: 'COP', category: input.category || 'Otros', accountId: account.id, accountName: account.name,
    description: `Gasto pendiente: ${input.description}`, date: serverTimestamp(), rawText: input.description, source: 'manual', confidence: 1,
    movementKind: 'payable_expense_created', affectsCash: false, affectsReport: true, affectsDebt: true, debtId: debt.id, excludeFromReports: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(auditCol(uid)), { action: 'create_payable_expense', debtId: debt.id, transactionId: tx.id, amount, createdAt: serverTimestamp() });
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
  const tx = doc(txCol(uid));
  const batch = writeBatch(db);
  batch.set(tx, {
    type: 'expense', amount: applied, currency: 'COP', category: 'Pago gasto pendiente', accountId: account.id, accountName: account.name,
    description: `Pago de gasto pendiente: ${debt.description}`, date: serverTimestamp(), rawText: `Pago de gasto pendiente ${debtId}`, source: 'manual', confidence: 1,
    movementKind: 'payable_expense_paid', affectsCash: true, affectsReport: false, affectsDebt: true, debtId, excludeFromReports: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.update(debtRef(uid, debtId), { amountPaid: newPaid, status: newStatus, closedAt: newStatus === 'paid' ? serverTimestamp() : null, lastPaymentAccountId: account.id, lastPaymentAccountName: account.name, updatedAt: serverTimestamp() });
  batch.update(accRef(uid, account.id), { currentBalance: increment(-applied), calculatedBalance: increment(-applied), updatedAt: serverTimestamp() });
  batch.set(doc(auditCol(uid)), { action: 'pay_payable_expense', debtId, transactionId: tx.id, amount: applied, createdAt: serverTimestamp() });
  await batch.commit();
  return tx;
}

export function assertSafeManualMutation(tx: Partial<Transaction>) {
  if (isProtectedTransaction(tx)) throw new Error('Movimiento protegido: usa reverso contable para conservar trazabilidad.');
}
