import { describe, expect, it } from 'vitest';
import firestoreRules from '../../firestore.rules?raw';

describe('firestore accounting audit rules', () => {
  it('allows owners to read and write accounting audit entries used by safe accounting operations', () => {
    expect(firestoreRules).toContain('match /accountingAudit/{auditId}');
    expect(firestoreRules).toMatch(/match\s+\/accountingAudit\/\{auditId\}\s*\{\s*allow read, write: if isOwner\(userId\);\s*\}/);
  });
});
