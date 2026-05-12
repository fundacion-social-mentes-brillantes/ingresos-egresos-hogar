import { collection, doc, increment, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { parseCurrencyInput, toMoney } from './accounting';
import type { Account } from '../types';

const txCol = (uid: string) => collection(db, 'users', uid, 'transactions');
const accRef = (uid: string, id: string) => doc(db, 'users', uid, 'accounts', id);
const auditCol = (uid: string) => collection(db, 'users', uid, 'accountingAudit');

function normalizeAmount(value: unknown): number {
  if (typeof value === 'number') return toMoney(value);
  return parseCurrencyInput(value);
}

export async function transferBetweenAccountsSafe(
  uid: string,
  params: {
    fromAccountId: string;
    toAccountId: string;
    amount: unknown;
    description?: string;
    date?: Date;
    allowNegativeBalance?: boolean;
  }
) {
  const amount = normalizeAmount(params.amount);
  if (!params.fromAccountId || !params.toAccountId) throw new Error('Selecciona cuenta origen y cuenta destino.');
  if (params.fromAccountId === params.toAccountId) throw new Error('La cuenta origen y destino deben ser diferentes.');
  if (amount <= 0) throw new Error('Escribe un valor mayor a cero.');

  const fromRef = accRef(uid, params.fromAccountId);
  const toRef = accRef(uid, params.toAccountId);
  const transferId = doc(txCol(uid)).id;
  const txOutRef = doc(txCol(uid));
  const txInRef = doc(txCol(uid));
  const auditRef = doc(auditCol(uid));

  await runTransaction(db, async (transaction) => {
    const fromSnap = await transaction.get(fromRef);
    const toSnap = await transaction.get(toRef);
    if (!fromSnap.exists()) throw new Error('La cuenta de origen no existe.');
    if (!toSnap.exists()) throw new Error('La cuenta de destino no existe.');

    const fromData = fromSnap.data() as Account;
    const toData = toSnap.data() as Account;
    const fromCurrentBalance = toMoney(fromData.currentBalance || 0);
    if (!params.allowNegativeBalance && fromCurrentBalance < amount) throw new Error('Saldo insuficiente en la cuenta de origen.');

    const timestamp = serverTimestamp();
    const txDate = params.date ? Timestamp.fromDate(params.date) : timestamp;
    const description = params.description || 'Transferencia entre cuentas';
    const rawText = `Transferencia de ${fromData.name} a ${toData.name}`;

    transaction.update(fromRef, { currentBalance: increment(-amount), calculatedBalance: increment(-amount), updatedAt: timestamp });
    transaction.update(toRef, { currentBalance: increment(amount), calculatedBalance: increment(amount), updatedAt: timestamp });

    transaction.set(txOutRef, {
      type: 'expense', amount, currency: 'COP', category: 'Transferencia entre cuentas',
      accountId: params.fromAccountId, accountName: fromData.name, description, rawText,
      source: 'manual', confidence: 1, transferId, transferDirection: 'out', transferAccountId: params.toAccountId,
      transferAccountName: toData.name, movementKind: 'transfer_out', affectsCash: true, affectsReport: false,
      affectsDebt: false, excludeFromReports: true, date: txDate, createdAt: timestamp, updatedAt: timestamp,
    });

    transaction.set(txInRef, {
      type: 'income', amount, currency: 'COP', category: 'Transferencia entre cuentas',
      accountId: params.toAccountId, accountName: toData.name, description, rawText,
      source: 'manual', confidence: 1, transferId, transferDirection: 'in', transferAccountId: params.fromAccountId,
      transferAccountName: fromData.name, movementKind: 'transfer_in', affectsCash: true, affectsReport: false,
      affectsDebt: false, excludeFromReports: true, date: txDate, createdAt: timestamp, updatedAt: timestamp,
    });

    transaction.set(auditRef, {
      action: 'create_transfer_safe', transferId, txOutId: txOutRef.id, txInId: txInRef.id,
      fromAccountId: params.fromAccountId, toAccountId: params.toAccountId, amount, description, createdAt: timestamp,
    });
  });

  return { transferId, txOutId: txOutRef.id, txInId: txInRef.id };
}
