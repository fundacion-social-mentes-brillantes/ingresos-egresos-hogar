import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { CHAT_DEBT_BLOCK_MESSAGE, CHAT_REVERSED_BLOCK_MESSAGE, classifyChatAccountingTarget, normalMovementKeepsEditAndDelete } from './chatAccountingSafety';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id || 'tx-1',
    type: overrides.type || 'expense',
    amount: overrides.amount ?? 45_000,
    currency: 'COP',
    category: overrides.category || 'Otros',
    accountId: overrides.accountId || 'cash',
    accountName: overrides.accountName || 'Efectivo',
    description: overrides.description || 'Movimiento normal',
    date: overrides.date || new Date('2026-05-12T12:00:00-05:00'),
    rawText: overrides.rawText || '',
    source: overrides.source || 'manual',
    confidence: overrides.confidence ?? 1,
    createdAt: overrides.createdAt || new Date('2026-05-12T12:00:00-05:00'),
    updatedAt: overrides.updatedAt || new Date('2026-05-12T12:00:00-05:00'),
    ...overrides,
  };
}

describe('chat accounting safety', () => {
  it('does not delete one transfer leg as a normal transaction', () => {
    const decision = classifyChatAccountingTarget(tx({ transferId: 'transfer-1', movementKind: 'transfer_out' }), 'delete_transaction');
    expect(decision.mode).toBe('transfer');
    expect(decision).toMatchObject({ operation: 'reverseTransfer', transferId: 'transfer-1' });
  });

  it('does not update one transfer leg as a normal transaction', () => {
    const decision = classifyChatAccountingTarget(tx({ transferId: 'transfer-1', movementKind: 'transfer_in', type: 'income' }), 'update_transaction');
    expect(decision.mode).toBe('transfer');
    expect(decision).toMatchObject({ operation: 'reverseTransfer', transferId: 'transfer-1' });
  });

  it('blocks debt movement deletion from chat as a normal movement', () => {
    const decision = classifyChatAccountingTarget(tx({ debtId: 'debt-1', debtMovementKind: 'loan_principal_out' }), 'delete_transaction');
    if (decision.mode !== 'blocked') throw new Error('Expected blocked decision');
    expect(decision.reason).toBe(CHAT_DEBT_BLOCK_MESSAGE);
  });

  it('blocks imported or historical movement from chat', () => {
    const decision = classifyChatAccountingTarget(tx({ batchImportId: 'batch-1', movementKind: 'historical_non_reportable', excludeFromReports: true }), 'delete_transaction');
    if (decision.mode !== 'blocked') throw new Error('Expected blocked decision');
    expect(decision.reason).toMatch(/hist[oó]rico|importado/i);
  });

  it('blocks already reversed movements from chat', () => {
    const decision = classifyChatAccountingTarget(tx({ isReversed: true }), 'delete_transaction');
    if (decision.mode !== 'blocked') throw new Error('Expected blocked decision');
    expect(decision.reason).toBe(CHAT_REVERSED_BLOCK_MESSAGE);
  });

  it('keeps pencil and paper bin behavior available for normal movements', () => {
    expect(normalMovementKeepsEditAndDelete(tx())).toBe(true);
    expect(classifyChatAccountingTarget(tx(), 'delete_transaction')).toMatchObject({ mode: 'normal', operation: 'reverseAccountingTransaction' });
    expect(classifyChatAccountingTarget(tx(), 'update_transaction')).toMatchObject({ mode: 'normal', operation: 'reverseAccountingTransaction' });
  });
});
