import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTransactions, getAccounts } from '../lib/firestore';
import type { Transaction, Account, FinancialSummary } from '../types';
import { startOfMonth, endOfMonth, subDays, startOfDay } from 'date-fns';

export function useTransactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [loading, setLoading]           = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [txs, accs] = await Promise.all([
        getTransactions(user.uid, 200),
        getAccounts(user.uid),
      ]);
      setTransactions(txs);
      setAccounts(accs);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return { transactions, accounts, loading, refresh };
}

export function useFinancialSummary(transactions: Transaction[]): FinancialSummary {
  const now   = new Date();
  const start = startOfMonth(now);
  const end   = endOfMonth(now);

  const monthly = transactions.filter(t => t.date >= start && t.date <= end);

  const totalIncome   = monthly.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
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
