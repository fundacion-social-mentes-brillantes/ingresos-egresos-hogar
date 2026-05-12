import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import type { Debt } from '../types';
import { summarizeDebts, toMoney } from '../lib/accounting';

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
  const amountOriginal = toMoney(data.amountOriginal);
  const amountPaid = toMoney(data.amountPaid);
  const status = data.status || (amountPaid >= amountOriginal ? 'paid' : amountPaid > 0 ? 'partial' : 'open');

  return {
    id,
    ...data,
    amountOriginal,
    amountPaid,
    status,
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

  const summary = useMemo(() => summarizeDebts(debts), [debts]);

  return { debts, loading, summary };
}
