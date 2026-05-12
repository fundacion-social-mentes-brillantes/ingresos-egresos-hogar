import { useState, useEffect, useCallback } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { getAccounts } from '../lib/firestore';
import type { Transaction, Account, FinancialSummary } from '../types';
import { startOfMonth, endOfMonth, subDays, startOfDay } from 'date-fns';

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeTransaction(id: string, data: Record<string, any>): Transaction {
  return {
    id,
    ...data,
    amount: Number(data.amount || 0),
    date: toDate(data.date),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Transaction;
}

function normalizeAccount(id: string, data: Record<string, any>): Account {
  return {
    id,
    ...data,
    currentBalance: Number(data.currentBalance || 0),
    initialBalance: Number(data.initialBalance || 0),
    active: data.active ?? true,
    createdAt: toDate(data.createdAt),
  } as Account;
}

export function useTransactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    if (!user) return;
    const accs = await getAccounts(user.uid);
    setAccounts(accs);
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setAccountsLoading(true);
    try {
      await refreshAccounts();
    } finally {
      setAccountsLoading(false);
    }
  }, [user, refreshAccounts]);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setAccounts([]);
      setTransactionsLoading(false);
      setAccountsLoading(false);
      return;
    }

    setTransactionsLoading(true);
    setAccountsLoading(true);

    const transactionsQuery = query(
      collection(db, `users/${user.uid}/transactions`),
      orderBy('date', 'desc'),
      limit(200)
    );

    const accountsQuery = query(
      collection(db, `users/${user.uid}/accounts`),
      orderBy('createdAt', 'asc')
    );

    const unsubscribeTransactions = onSnapshot(
      transactionsQuery,
      (snapshot) => {
        setTransactions(snapshot.docs.map((doc) => normalizeTransaction(doc.id, doc.data())));
        setTransactionsLoading(false);
      },
      (error) => {
        console.error('Realtime transactions listener failed:', error);
        setTransactionsLoading(false);
      }
    );

    const unsubscribeAccounts = onSnapshot(
      accountsQuery,
      (snapshot) => {
        setAccounts(snapshot.docs.map((doc) => normalizeAccount(doc.id, doc.data())));
        setAccountsLoading(false);
      },
      (error) => {
        console.error('Realtime accounts listener failed:', error);
        setAccountsLoading(false);
      }
    );

    return () => {
      unsubscribeTransactions();
      unsubscribeAccounts();
    };
  }, [user]);

  return { transactions, accounts, loading: transactionsLoading || accountsLoading, refresh };
}

export function useFinancialSummary(transactions: Transaction[]): FinancialSummary {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);

  const monthly = transactions.filter(t => t.date >= start && t.date <= end);

  const totalIncome = monthly.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = monthly.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const byCategory = monthly
    .filter(t => t.type === 'expense')
    .reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    byCategory,
    range: 'this_month',
    generatedAt: now,
  };
}

export function useLast7Days(transactions: Transaction[]) {
  const cutoff = subDays(startOfDay(new Date()), 6);
  return transactions.filter(t => t.date >= cutoff && t.type === 'expense');
}
