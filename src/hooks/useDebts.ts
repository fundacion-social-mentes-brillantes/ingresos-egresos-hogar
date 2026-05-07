import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import type { Debt } from '../types';

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toOptionalDate(value: unknown): Date | null {
  if (!value) return null;
  return toDate(value);
}

function normalizeDebt(id: string, data: Record<string, any>): Debt {
  const amountOriginal = Number(data.amountOriginal || 0);
  const amountPaid = Number(data.amountPaid || 0);
  return {
    id,
    ...data,
    amountOriginal,
    amountPaid,
    dueDate: toOptionalDate(data.dueDate),
    closedAt: toOptionalDate(data.closedAt),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Debt;
}

export function useDebts() {
  const { user } = useAuth();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setDebts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const debtsQuery = query(collection(db, `users/${user.uid}/debts`), orderBy('createdAt', 'desc'), limit(200));
    const unsubscribe = onSnapshot(
      debtsQuery,
      (snapshot) => {
        setDebts(snapshot.docs.map((doc) => normalizeDebt(doc.id, doc.data())));
        setLoading(false);
      },
      (error) => {
        console.error('Realtime debts listener failed:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const summary = useMemo(() => {
    const open = debts.filter((debt) => debt.status !== 'paid');
    const receivable = open
      .filter((debt) => debt.direction === 'receivable')
      .reduce((sum, debt) => sum + Math.max(0, debt.amountOriginal - debt.amountPaid), 0);
    const payable = open
      .filter((debt) => debt.direction === 'payable')
      .reduce((sum, debt) => sum + Math.max(0, debt.amountOriginal - debt.amountPaid), 0);

    return {
      receivable,
      payable,
      net: receivable - payable,
      openCount: open.length,
    };
  }, [debts]);

  return { debts, loading, summary };
}
