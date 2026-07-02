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
  // Trae por accountId Y por accountName, igual que la atribucion del motor
  // (summarizeAccount->transactionBelongsToAccount). Antes solo consultaba por
  // accountId, asi que la conciliacion ignoraba movimientos legacy guardados sin
  // accountId (solo nombre) que la pantalla Cuentas SI cuenta -> el saldo
  // calculado/diferencia que se persistia no coincidia con lo que el usuario vio.
  const [byId, byName] = await Promise.all([
    getDocs(query(txCol(uid), where('accountId', '==', account.id))),
    getDocs(query(txCol(uid), where('accountName', '==', account.name))),
  ]);
  const map = new Map<string, Transaction>();
  for (const item of [...byId.docs, ...byName.docs]) {
    const data = item.data() as Record<string, any>;
    map.set(item.id, { id: item.id, ...data, amount: toMoney(data.amount), date: toDate(data.date), createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as Transaction);
  }
  // summarizeAccount vuelve a filtrar con transactionBelongsToAccount (prioriza
  // accountId), asi que un tx con accountId de OTRA cuenta pero mismo nombre
  // (cuenta renombrada) queda correctamente excluido.
  return [...map.values()];
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
      // OJO: NO sobreescribir calculatedBalance aqui. Ese campo lo mantiene el
      // motor via increment() atomico; escribirlo como valor absoluto calculado
      // FUERA de la transaccion pisaria un increment concurrente (un movimiento
      // creado justo mientras se concilia). El recalculo se guarda aparte solo
      // como dato informativo de la conciliacion.
      ledgerCalculatedBalance: calculatedBalance,
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
  const movementKind = input.movementKind || (input.excludeFromReports ? 'historical_non_reportable' : input.type === 'income' ? 'income' : 'expense');
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
  const reverseRef = doc(txCol(uid));
  const auditDoc = doc(auditCol(uid));
  // runTransaction (no writeBatch): leemos el original DENTRO de la transaccion
  // y revalidamos isReversed ahi mismo. Asi un doble reverso concurrente (doble
  // clic, dos dispositivos, reintento por red) ve isReversed=true y aborta, en
  // vez de aplicar el increment dos veces y descuadrar el saldo.
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(txRef(uid, transactionId));
    if (!snap.exists()) throw new Error('El movimiento no existe.');
    const data = snap.data() as Record<string, any>;
    const original = { id: snap.id, ...data, amount: toMoney(data.amount) } as Transaction;
    const blockReason = genericReversalBlockReason(original);
    if (blockReason) throw new Error(blockReason);
    if (isProtectedTransaction(original)) throw new Error('Movimiento protegido: usa su flujo especifico para conservar la contabilidad.');
    const amount = toMoney(original.amount);
    const reverseType: TransactionType = original.type === 'income' ? 'expense' : 'income';
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
    transaction.update(txRef(uid, original.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
    transaction.set(reverseRef, reversePayload);
    if (delta !== 0 && original.accountId) transaction.update(accRef(uid, original.accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
    transaction.set(auditDoc, { action: 'reverse_transaction', transactionId: original.id, reverseTransactionId: reverseRef.id, reason, delta, createdAt: serverTimestamp() });
  });
  return reverseRef;
}

// Correccion ATOMICA de un movimiento normal: reverso del original + creacion
// del corregido + ajustes de saldo, todo en UNA transaccion. Antes esto eran dos
// commits separados (reversar y luego crear): si fallaba el segundo, el dinero
// quedaba reversado sin reemplazo y el usuario creia que habia "editado".
export async function correctAccountingTransaction(uid: string, transactionId: string, input: {
  type: TransactionType;
  amount: unknown;
  accountId: string;
  category?: string;
  description?: string;
  date?: Date;
  source?: 'manual' | 'bot';
  rawText?: string;
  excludeFromReports?: boolean;
}, reason = 'Correccion contable') {
  const amount = normalizeAmount(input.amount);
  if (amount <= 0) throw new Error('El valor debe ser mayor que cero.');
  const reverseRef = doc(txCol(uid));
  const correctedRef = doc(txCol(uid));
  const auditRef = doc(auditCol(uid));

  await runTransaction(db, async (transaction) => {
    // Lecturas primero (regla de Firestore), con revalidacion dentro de la tx.
    const snap = await transaction.get(txRef(uid, transactionId));
    if (!snap.exists()) throw new Error('El movimiento no existe.');
    const data = snap.data() as Record<string, any>;
    const original = { id: snap.id, ...data, amount: toMoney(data.amount) } as Transaction;
    const blockReason = genericReversalBlockReason(original);
    if (blockReason) throw new Error(blockReason);
    if (isProtectedTransaction(original)) throw new Error('Movimiento protegido: usa su flujo especifico para conservar la contabilidad.');
    const accountSnap = await transaction.get(accRef(uid, input.accountId));
    if (!accountSnap.exists()) throw new Error('La cuenta no existe.');
    const accountName = String((accountSnap.data() as Record<string, any>).name || '');

    // 1) Reverso del original.
    const originalAmount = toMoney(original.amount);
    const reverseType: TransactionType = original.type === 'income' ? 'expense' : 'income';
    const reverseDelta = affectsCash(original) ? (original.type === 'income' ? -originalAmount : originalAmount) : 0;
    transaction.update(txRef(uid, original.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
    transaction.set(reverseRef, {
      type: reverseType,
      amount: originalAmount,
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
    });

    // 2) Movimiento corregido.
    const excludeFromReports = input.excludeFromReports ?? Boolean(original.excludeFromReports);
    const correctedDelta = input.type === 'income' ? amount : -amount;
    transaction.set(correctedRef, {
      type: input.type,
      amount,
      currency: 'COP' as const,
      category: input.category || original.category || (input.type === 'income' ? 'Ingreso' : 'Otros'),
      accountId: input.accountId,
      accountName,
      description: input.description || `Correccion de ${original.description}`,
      date: ts(input.date),
      rawText: input.rawText || input.description || original.rawText || '',
      source: input.source || 'manual',
      confidence: 1,
      movementKind: input.type === 'income' ? 'income' : 'expense',
      affectsCash: true,
      affectsReport: !excludeFromReports,
      affectsDebt: false,
      debtId: null,
      excludeFromReports,
      correctionOf: original.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 3) Ajustes de saldo NETOS por cuenta (una sola escritura por cuenta,
    // incluso si el reverso y el corregido caen en la misma cuenta).
    const deltasPorCuenta = new Map<string, number>();
    if (reverseDelta !== 0 && original.accountId) deltasPorCuenta.set(original.accountId, (deltasPorCuenta.get(original.accountId) || 0) + reverseDelta);
    deltasPorCuenta.set(input.accountId, (deltasPorCuenta.get(input.accountId) || 0) + correctedDelta);
    deltasPorCuenta.forEach((delta, accountId) => {
      if (delta !== 0) transaction.update(accRef(uid, accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
    });

    transaction.set(auditRef, { action: 'correct_transaction_atomic', transactionId: original.id, reverseTransactionId: reverseRef.id, correctedTransactionId: correctedRef.id, amount, reason, createdAt: serverTimestamp() });
  });
  return correctedRef;
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
  // Una query no puede ir dentro de una transaccion de Firestore, asi que
  // primero ubicamos los IDs de las dos patas y luego, DENTRO de runTransaction,
  // releemos cada documento y revalidamos la integridad ahi mismo. Un doble
  // reverso concurrente (doble clic, dos dispositivos, reintento de red) ve
  // isReversed=true en la relectura y aborta, en vez de duplicar los increments
  // en ambas cuentas.
  const snap = await getDocs(query(txCol(uid), where('transferId', '==', transferId)));
  const legIds = snap.docs.map((item) => item.id);
  if (legIds.length !== 2) throw new Error('Transferencia rota, incompleta o ya reversada');
  const reverseRefs = [doc(txCol(uid)), doc(txCol(uid))];
  const auditRef = doc(auditCol(uid));

  await runTransaction(db, async (transaction) => {
    const legs: Transaction[] = [];
    for (const id of legIds) {
      const legSnap = await transaction.get(txRef(uid, id));
      if (!legSnap.exists()) throw new Error('Transferencia rota, incompleta o ya reversada');
      const data = legSnap.data() as Record<string, any>;
      legs.push({ id: legSnap.id, ...data, amount: toMoney(data.amount) } as Transaction);
    }
    const out = legs.filter((tx) => inferMovementKind(tx) === 'transfer_out');
    const input = legs.filter((tx) => inferMovementKind(tx) === 'transfer_in');
    const valid = out.length === 1 && input.length === 1 && toMoney(out[0].amount) === toMoney(input[0].amount) && !legs.some((tx) => tx.isReversed || tx.reversalOf);
    if (!valid) throw new Error('Transferencia rota, incompleta o ya reversada');

    legs.forEach((tx, index) => {
      const amount = toMoney(tx.amount);
      const reverseType: TransactionType = tx.type === 'income' ? 'expense' : 'income';
      const delta = tx.type === 'income' ? -amount : amount;
      transaction.update(txRef(uid, tx.id), { isReversed: true, reversedAt: serverTimestamp(), reversalReason: reason, updatedAt: serverTimestamp() });
      transaction.set(reverseRefs[index], {
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
      transaction.update(accRef(uid, tx.accountId), { currentBalance: increment(delta), calculatedBalance: increment(delta), updatedAt: serverTimestamp() });
    });
    transaction.set(auditRef, { action: 'reverse_transfer', transferId, reason, createdAt: serverTimestamp() });
  });
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
  if (!account?.id) throw new Error('Elige la cuenta para mover la plata.');
  const tx = doc(txCol(uid));
  const auditDoc = doc(auditCol(uid));
  // runTransaction (no writeBatch) para que la lectura del saldo de la deuda y
  // la escritura de amountPaid sean atomicas: dos pagos simultaneos ya no se
  // pisan ni dejan amountPaid inconsistente.
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(debtRef(uid, debtId));
    if (!snap.exists()) throw new Error('La deuda no existe.');
    const debt = { id: snap.id, ...snap.data() } as Debt;
    if (debt.direction !== 'payable') throw new Error('Solo se pueden pagar cuentas por pagar.');
    const pendiente = Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid));
    const applied = Math.min(amount, pendiente);
    if (applied <= 0) throw new Error('Esta cuenta por pagar ya esta saldada.');
    const newPaid = toMoney(debt.amountPaid) + applied;
    const newStatus = newPaid >= toMoney(debt.amountOriginal) ? 'paid' : 'partial';
    transaction.set(tx, {
      type: 'expense', amount: applied, currency: 'COP', category: 'Pago gasto pendiente', accountId: account.id, accountName: account.name,
      description: `Pago de gasto pendiente: ${debt.description}`, date: serverTimestamp(), rawText: `Pago de gasto pendiente ${debtId}`, source: 'manual', confidence: 1,
      movementKind: 'payable_expense_paid', affectsCash: true, affectsReport: false, affectsDebt: true, debtId, excludeFromReports: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    transaction.update(debtRef(uid, debtId), { amountPaid: newPaid, status: newStatus, closedAt: newStatus === 'paid' ? serverTimestamp() : null, lastPaymentAccountId: account.id, lastPaymentAccountName: account.name, updatedAt: serverTimestamp() });
    transaction.update(accRef(uid, account.id), { currentBalance: increment(-applied), calculatedBalance: increment(-applied), updatedAt: serverTimestamp() });
    transaction.set(auditDoc, { action: 'pay_payable_expense', debtId, transactionId: tx.id, amount: applied, createdAt: serverTimestamp() });
  });
  return tx;
}

export function assertSafeManualMutation(tx: Partial<Transaction>) {
  if (isProtectedTransaction(tx)) throw new Error('Movimiento protegido: usa reverso contable para conservar trazabilidad.');
}
