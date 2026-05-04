// ── Core domain types ──────────────────────────────────────────────────────

export type TransactionType = 'income' | 'expense';
export type TransactionSource = 'bot' | 'manual';
export type AccountType = 'cash' | 'nequi' | 'daviplata' | 'bank' | 'other';
export type QueryRange = 'this_month' | 'last_3_days' | 'last_7_days' | 'custom';
export type QueryMetric = 'expenses' | 'income' | 'balance' | 'by_category';
export type BotIntent =
  | 'create_transaction'
  | 'query_summary'
  | 'update_transaction'
  | 'delete_transaction'
  | 'clarify'
  | 'general_help';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  createdAt: Date;
  defaultCurrency: 'COP';
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  currentBalance: number;
  active: boolean;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: 'COP';
  category: string;
  accountId: string;
  accountName: string;
  description: string;
  date: Date;
  rawText: string;
  source: TransactionSource;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  createdAt: Date;
  suggestedNextQuestion?: string;
  emotionalTone?: string;
  loading?: boolean;
}

export interface AppSettings {
  autoCreateTransactions: boolean;
  askConfirmationWhenAmbiguous: boolean;
  monthlyStartDay: number;
}

// ── Bot response shape ─────────────────────────────────────────────────────

export interface BotTransactionPayload {
  type: TransactionType;
  amount: number;
  category: string;
  accountName: string;
  description: string;
  date: 'today' | string;
}

export interface BotQueryPayload {
  range: 'today' | 'last_3_days' | 'last_7_days' | 'this_month' | 'custom';
  metric: 'expenses' | 'income' | 'balance' | 'by_category' | 'behavior_analysis';
}

export interface BotAction {
  intent: BotIntent;
  replyToUser: string;
  shouldCreateTransaction?: boolean;
  transaction?: BotTransactionPayload;
  query?: BotQueryPayload;
  needsConfirmation?: boolean;
  confidence: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
}

// ── Firebase callable response ─────────────────────────────────────────────

export interface BotResponse {
  replyToUser: string;
  intent: BotIntent;
  transactionCreated?: Transaction;
  summary?: FinancialSummary;
  suggestedNextQuestion?: string;
  emotionalTone?: string;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  byCategory: Record<string, number>;
  range: QueryRange;
  generatedAt: Date;
}

// ── UI helpers ─────────────────────────────────────────────────────────────

export const CATEGORIES = [
  'Alimentación',
  'Transporte',
  'Hogar',
  'Salud',
  'Educación',
  'Entretenimiento',
  'Ropa',
  'Tecnología',
  'Ahorro',
  'Ingreso',
  'Otros',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_ACCOUNTS = [
  { name: 'Efectivo', type: 'cash' as AccountType },
  { name: 'Nequi', type: 'nequi' as AccountType },
  { name: 'Daviplata', type: 'daviplata' as AccountType },
  { name: 'Banco', type: 'bank' as AccountType },
];

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  cash: 'Efectivo',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  bank: 'Banco',
  other: 'Otro',
};

export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
