import { describe, expect, it } from 'vitest';
import firestoreRules from '../../firestore.rules?raw';

describe('firestore accounting audit rules', () => {
  it('allows owners to read and write accounting audit entries used by safe accounting operations', () => {
    expect(firestoreRules).toContain('match /accountingAudit/{auditId}');
    expect(firestoreRules).toMatch(/match\s+\/accountingAudit\/\{auditId\}\s*\{\s*allow read, write: if isOwner\(userId\);\s*\}/);
  });

  it('rejects money with decimals (whole COP pesos only)', () => {
    expect(firestoreRules).toContain('math.floor(value)');
    expect(firestoreRules).toContain('wholeMoney(data.amount)');
    expect(firestoreRules).toContain('wholeMoney(data.amountOriginal)');
    expect(firestoreRules).toContain('wholeMoney(data.amountPaid)');
  });

  it('caps debt payments at the original amount', () => {
    expect(firestoreRules).toContain('data.amountPaid <= data.amountOriginal');
  });

  it('validates the recoverable trash (deletedTransactions) because restoring moves money', () => {
    expect(firestoreRules).toContain('match /deletedTransactions/{deletedId}');
    expect(firestoreRules).toContain('validDeletedTransaction(request.resource.data)');
  });

  it('validates chat messages and keeps the default deny catch-all', () => {
    expect(firestoreRules).toContain('validChatMessage(request.resource.data)');
    expect(firestoreRules).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });
});
