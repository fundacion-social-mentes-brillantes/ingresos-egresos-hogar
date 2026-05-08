import type { AccountType } from '../types';

export interface AccountBrandAsset {
  type: AccountType;
  label: string;
  asset: string;
  accent: string;
  gradient: string;
  chip: string;
}

export const accountBrandAssets: Record<AccountType, AccountBrandAsset> = {
  cash: {
    type: 'cash',
    label: 'Efectivo',
    asset: '/assets/brands/account-cash.svg',
    accent: '#27df9a',
    gradient: 'from-emerald-400/20 via-teal-400/10 to-cyan-400/10',
    chip: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  },
  nequi: {
    type: 'nequi',
    label: 'Nequi',
    asset: '/assets/brands/account-nequi.svg',
    accent: '#b56bff',
    gradient: 'from-fuchsia-400/20 via-violet-400/12 to-blue-400/10',
    chip: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-300',
  },
  daviplata: {
    type: 'daviplata',
    label: 'Daviplata',
    asset: '/assets/brands/account-daviplata.svg',
    accent: '#ff6b5f',
    gradient: 'from-amber-300/22 via-red-400/14 to-rose-400/10',
    chip: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  },
  bank: {
    type: 'bank',
    label: 'Banco',
    asset: '/assets/brands/account-bank.svg',
    accent: '#62a8ff',
    gradient: 'from-blue-400/22 via-indigo-400/12 to-slate-400/10',
    chip: 'border-blue-400/25 bg-blue-400/10 text-blue-300',
  },
  other: {
    type: 'other',
    label: 'Otro',
    asset: '/assets/brands/account-other.svg',
    accent: '#94a3b8',
    gradient: 'from-slate-300/18 via-slate-400/10 to-blue-400/8',
    chip: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
  },
};

export function inferAccountType(name?: string | null): AccountType {
  const value = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (value.includes('nequi')) return 'nequi';
  if (value.includes('davi')) return 'daviplata';
  if (value.includes('banco') || value.includes('bank') || value.includes('cuenta')) return 'bank';
  if (value.includes('efectivo') || value.includes('cash')) return 'cash';
  return 'other';
}

export function getAccountBrandAsset(type?: AccountType | null, name?: string | null): AccountBrandAsset {
  return accountBrandAssets[type || inferAccountType(name)] || accountBrandAssets.other;
}
