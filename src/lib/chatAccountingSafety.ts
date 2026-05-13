import type { Transaction } from '../types';
import { inferMovementKind } from './accounting';

export const CHAT_DEBT_BLOCK_MESSAGE = 'Este movimiento pertenece a una deuda o préstamo. Para anularlo, ve a Deudas y usa la papelera/anulación segura.';
export const CHAT_HISTORICAL_BLOCK_MESSAGE = 'Este movimiento es histórico/importado. No lo anulo desde el chat para no convertirlo accidentalmente en gasto o ingreso reportable.';
export const CHAT_TRANSFER_WITHOUT_ID_MESSAGE = 'Este movimiento parece ser una transferencia, pero no tiene transferId. No lo anulo desde el chat porque podría romper una sola pata.';

export const CHAT_REVERSED_BLOCK_MESSAGE = 'Este movimiento ya fue reversado o es un reverso contable. No lo anulo de nuevo desde el chat.';

export type ChatAccountingIntent = 'delete_transaction' | 'update_transaction';

export type ChatAccountingDecision =
  | { mode: 'normal'; operation: 'reverseAccountingTransaction'; intent: ChatAccountingIntent }
  | { mode: 'transfer'; operation: 'reverseTransfer'; transferId: string; intent: ChatAccountingIntent }
  | { mode: 'blocked'; reason: string; intent: ChatAccountingIntent };

export function classifyChatAccountingTarget(tx: Partial<Transaction>, intent: ChatAccountingIntent): ChatAccountingDecision {
  const kind = inferMovementKind(tx);

  if (tx.isReversed || tx.reversalOf) {
    return { mode: 'blocked', reason: CHAT_REVERSED_BLOCK_MESSAGE, intent };
  }

  if (tx.debtId || tx.debtMovementKind) {
    return { mode: 'blocked', reason: CHAT_DEBT_BLOCK_MESSAGE, intent };
  }

  if (tx.batchImportId || kind === 'historical_non_reportable') {
    return { mode: 'blocked', reason: CHAT_HISTORICAL_BLOCK_MESSAGE, intent };
  }

  if (tx.transferId || kind === 'transfer_in' || kind === 'transfer_out') {
    if (!tx.transferId) return { mode: 'blocked', reason: CHAT_TRANSFER_WITHOUT_ID_MESSAGE, intent };
    return { mode: 'transfer', operation: 'reverseTransfer', transferId: tx.transferId, intent };
  }

  return { mode: 'normal', operation: 'reverseAccountingTransaction', intent };
}

export function normalMovementKeepsEditAndDelete(tx: Partial<Transaction>): boolean {
  const deleteDecision = classifyChatAccountingTarget(tx, 'delete_transaction');
  const updateDecision = classifyChatAccountingTarget(tx, 'update_transaction');
  return deleteDecision.mode === 'normal' && updateDecision.mode === 'normal';
}
