// ── Core domain types ──────────────────────────────────────────────────────

export type TransactionType = 'income' | 'expense';
export type TransactionSource = 'bot' | 'manual';
export type AccountType = 'cash' | 'nequi' | 'daviplata' | 'bank' | 'other';
export type QueryRange = 'today' | 'this_month' | 'last_3_days' | 'last_7_days' | 'custom';
export type QueryMetric = 'expenses' | 'income' | 'balance' | 'by_category' | 'behavior_analysis';
export type DebtDirection = 'receivable' | 'payable';
export type DebtStatus = 'open' | 'partial' | 'paid';
export type DebtSource = 'bot' | 'manual';
export type AiRiskLevel = 'low' | 'medium' | 'high';
export type AiAssistantMode = 'registro' | 'analisis' | 'coach' | 'emocional' | 'estrategia' | 'explicacion' | 'conversacion';
export type BotIntent =
  | 'create_transaction'
  | 'query_summary'
  | 'analyze_behavior'
  | 'financial_advice'
  | 'update_transaction'
  | 'delete_transaction'
  | 'create_debt'
  | 'query_debts'
  | 'register_debt_payment'
  | 'close_debt'
  | 'clarify'
  | 'conversation_only'
  | 'import_transactions';

export type ActionLogStatus = 'pending' | 'confirmed' | 'executed' | 'cancelled' | 'failed';
export type ActionLogSource = 'bot' | 'manual' | 'system';

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

export interface DeletedTransaction extends Transaction {
  deletedId: string;
  originalId: string;
  deletedAt: Date;
  recoverable?: boolean;
}

export interface Debt {
  id: string;
  direction: DebtDirection;
  personName: string;
  amountOriginal: number;
  amountPaid: number;
  currency: 'COP';
  description: string;
  notes?: string;
  dueDate?: Date | null;
  status: DebtStatus;
  source: DebtSource;
  confidence?: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
}

export interface AiInsight {
  title: string;
  detail: string;
  severity?: AiRiskLevel;
}

export interface AiMemoryProfile {
  preferredName?: string;
  tonePreference?: string;
  financialGoals?: string[];
  sensitiveCategories?: string[];
  knownIncomePattern?: string;
  spendingPatterns?: string[];
  coachingNotes?: string[];
  lastUpdatedAt?: Date;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  createdAt: Date;
  suggestedNextQuestion?: string;
  emotionalTone?: string;
  loading?: boolean;
  transactionId?: string;
  debtId?: string;
  summary?: FinancialSummary;
  imageUrl?: string;
  assistantMode?: AiAssistantMode;
  riskLevel?: AiRiskLevel;
  insights?: AiInsight[];
  suggestedActions?: string[];
}

export interface ActionLog {
  id: string;
  action: string;
  entityType: 'transaction' | 'debt' | 'backup' | 'chat' | 'settings' | 'system';
  entityId?: string;
  description: string;
  before?: unknown;
  after?: unknown;
  source: ActionLogSource;
  status: ActionLogStatus;
  createdAt: Date;
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
  currency: 'COP';
  category: string;
  accountName: string;
  description: string;
  date: 'today' | string;
}

export interface BotDebtPayload {
  direction: DebtDirection;
  personName: string;
  amount: number;
  currency: 'COP';
  description: string;
  notes?: string;
  dueDate?: 'today' | 'tomorrow' | string | null;
}

export interface BotDebtPaymentPayload {
  direction?: DebtDirection | null;
  personName?: string;
  amount?: number | null;
  scope?: 'last' | 'person_match' | 'amount_match';
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
  debt?: BotDebtPayload;
  debtPayment?: BotDebtPaymentPayload;
  query?: BotQueryPayload;
  needsConfirmation?: boolean;
  confidence: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
  assistantMode?: AiAssistantMode;
  riskLevel?: AiRiskLevel;
  insights?: AiInsight[];
  suggestedActions?: string[];
  memoryPatch?: Partial<AiMemoryProfile>;
}

// ── Firebase callable response ─────────────────────────────────────────────

export interface BotResponse {
  replyToUser: string;
  intent: BotIntent;
  transactionCreated?: Transaction;
  debtCreated?: Debt;
  summary?: FinancialSummary;
  suggestedNextQuestion?: string;
  emotionalTone?: string;
}

export interface ChatWithBotRequest {
  message: string;
  imageBase64?: string;
  imageMimeType?: string;
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
