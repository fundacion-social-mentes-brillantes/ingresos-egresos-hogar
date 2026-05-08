import React, { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AlertCircle, Bot, Camera, CheckCircle2, Loader2, RotateCcw, Send, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { auth, db } from '../lib/firebase';
import {
  addAccount,
  addActionLog,
  addChatMessage,
  addDebt,
  addTransaction,
  deleteTransaction,
  getAccounts,
  getDebts,
  getTransactions,
  getTransactionsByRange,
  registerDebtPayment,
  restoreLastDeletedTransaction,
  updateDebt,
  updateTransaction,
} from '../lib/firestore';
import type { Account, ChatMessage, Debt, DebtDirection, FinancialSummary, Transaction, TransactionType } from '../types';
import { DEFAULT_ACCOUNTS, formatCOP } from '../types';

interface ChatPageProps { embedded?: boolean; }
interface ChatErrorState { friendly: string; code?: string; message?: string; details?: string; }
type DangerousIntent = 'delete_transaction' | 'update_transaction' | 'register_debt_payment' | 'close_debt';

interface VercelBotAction {
  intent: string;
  replyToUser: string;
  transaction?: { type?: TransactionType; amount?: number | string; category?: string; accountName?: string; description?: string; date?: string; };
  debt?: { direction?: DebtDirection; personName?: string; amount?: number | string; description?: string; notes?: string; dueDate?: string | null; };
  debtPayment?: { direction?: DebtDirection | null; personName?: string; amount?: number | string | null; scope?: 'last' | 'person_match' | 'amount_match'; };
  deleteTarget?: { scope?: 'last' | 'last_income' | 'last_expense' | 'amount_match'; type?: TransactionType | null; amount?: number | string | null; descriptionHint?: string; };
  updateTarget?: { scope?: 'last' | 'last_income' | 'last_expense' | 'amount_match'; type?: TransactionType | null; amount?: number | string | null; descriptionHint?: string; };
  transactionUpdate?: { amount?: number | string | null; category?: string; description?: string; };
  confidence?: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
}

interface PendingAction {
  id: string;
  intent: DangerousIntent;
  botAction: VercelBotAction;
  message: string;
  summaryText: string;
  target?: Transaction | Debt | null;
}

function formatErrorDetails(details: unknown): string | undefined {
  if (!details) return undefined;
  if (typeof details === 'string') return details;
  try { return JSON.stringify(details); } catch { return String(details); }
}

function getFriendlyChatError(error: any): ChatErrorState {
  const code = error?.code || 'desconocido';
  const message = error?.message ? String(error.message) : undefined;
  const details = formatErrorDetails(error?.details);
  if (code === 'deepseek/vercel-api') return { friendly: 'DeepSeek V4 Pro no respondió desde Vercel. Revisa el detalle técnico abajo.', code, message, details };
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return { friendly: 'Faltan permisos de Firestore para esta acción. Revisa que las reglas estén desplegadas.', code, message, details };
  if (code === 'functions/unauthenticated' || code === 'auth/no-token') return { friendly: 'Tu sesión se venció. Cierra sesión y vuelve a entrar.', code, message, details };
  return { friendly: `No pude procesar el mensaje. Código: ${code}`, code, message, details };
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeAmount(value: string): number {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  const match = text.match(/(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*(mil|lucas?|k|millones?|millon)?/i);
  if (!match) return 0;
  const base = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(base)) return 0;
  const scale = match[2] || '';
  if (scale.startsWith('mil') || scale.startsWith('luca') || scale === 'k') return base * 1000;
  if (scale.startsWith('millon')) return base * 1000000;
  return base;
}

function botAmountToNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return normalizeAmount(String(value));
}

function inferTransactionType(message: string): TransactionType | null {
  const text = normalizeText(message);
  const incomeWords = ['me entro', 'entro plata', 'entraron', 'recibi', 'recibo', 'me pagaron', 'cobre', 'cobro', 'me consignaron', 'me depositaron', 'vendi', 'venta', 'ingrese', 'ingresa', 'ingreso', 'sueldo', 'salario', 'quincena'];
  const expenseWords = ['me gaste', 'gaste', 'gasto', 'egreso', 'compre', 'compra', 'pague', 'almorce', 'recargue', 'tanquie', 'me toco pagar'];
  if (incomeWords.some((word) => text.includes(word))) return 'income';
  if (expenseWords.some((word) => text.includes(word))) return 'expense';
  return null;
}

function inferDescription(message: string): string {
  const description = message
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '')
    .replace(/\b(me gaste|gast[eé]|gasto|gastos|egreso|egresos|compre|compr[eé]|pague|pagu[eé]|me pagaron|recibi|recib[ií]|recibo|cobre|cobr[eé]|ingresa|ingrese|ingreso|ingresos|entra|entr[oó]|entraron|agrega|registrar|tengo|en|por|con|de)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return description || 'Movimiento registrado desde el chat';
}

function inferCategory(message: string, type: TransactionType): string {
  if (type === 'income') return 'Ingreso';
  const text = normalizeText(message);
  if (['helado', 'comida', 'mercado', 'cafe', 'almuerzo', 'restaurante', 'tienda'].some((word) => text.includes(word))) return 'Alimentación';
  if (['bus', 'taxi', 'uber', 'gasolina', 'transporte', 'pasaje'].some((word) => text.includes(word))) return 'Transporte';
  if (['arriendo', 'luz', 'agua', 'gas', 'internet', 'hogar'].some((word) => text.includes(word))) return 'Hogar';
  if (['medicina', 'farmacia', 'salud', 'doctor'].some((word) => text.includes(word))) return 'Salud';
  return 'Otros';
}

function botDateToDate(value?: string): Date {
  if (!value || value === 'today') return new Date();
  if (value === 'yesterday') { const date = new Date(); date.setDate(date.getDate() - 1); return date; }
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function botOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  if (value === 'today') return new Date();
  if (value === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); return d; }
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isConfirmText(message: string): boolean {
  const text = normalizeText(message);
  return ['si', 'sí', 'confirmo', 'confirmar', 'dale', 'hazlo', 'acepto', 'ok'].includes(text);
}
function isCancelText(message: string): boolean {
  const text = normalizeText(message);
  return ['no', 'cancelar', 'cancela', 'no hagas nada', 'dejalo', 'déjalo'].includes(text);
}
function isUndoText(message: string): boolean {
  const text = normalizeText(message);
  return ['deshacer', 'deshaz', 'deshazlo', 'restaurar', 'recuperar', 'undo'].some((word) => text.includes(word));
}
function looksLikeDeleteRequest(message: string): boolean {
  const text = normalizeText(message);
  return ['borra', 'borrar', 'elimina', 'eliminar', 'quita', 'quitar', 'anula', 'anular'].some((word) => text.includes(word));
}

function debtRemaining(debt: Debt): number { return Math.max(0, debt.amountOriginal - debt.amountPaid); }
function personMatch(debt: Debt, name?: string): boolean {
  if (!name) return true;
  const a = normalizeText(debt.personName), b = normalizeText(name);
  return a.includes(b) || b.includes(a);
}

async function ensureLocalAccounts(uid: string): Promise<Account[]> {
  const existing = await getAccounts(uid);
  if (existing.length > 0) return existing;
  await Promise.all(DEFAULT_ACCOUNTS.map((account) => addAccount(uid, { ...account, initialBalance: 0, currentBalance: 0, active: true })));
  return getAccounts(uid);
}

function buildSummary(transactions: Transaction[]): FinancialSummary {
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses = transactions.filter((t) => t.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const byCategory = transactions.filter((t) => t.type === 'expense').reduce((acc, tx) => {
    acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
    return acc;
  }, {} as Record<string, number>);
  return { totalIncome, totalExpenses, balance: totalIncome - totalExpenses, byCategory, range: 'this_month', generatedAt: new Date() };
}

async function getLocalMonthlySummary(uid: string): Promise<FinancialSummary> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return buildSummary(await getTransactionsByRange(uid, start, end));
}

function buildVercelContext(accounts: Account[], summary: FinancialSummary, recentTransactions: Transaction[], debts: Debt[]): string {
  const recent = recentTransactions.slice(0, 50).map((tx, index) => `${index + 1}. ${tx.type === 'income' ? 'ingreso' : 'gasto'} ${formatCOP(tx.amount)} | ${tx.category} | ${tx.description} | cuenta ${tx.accountName}`);
  const open = debts.filter((d) => d.status !== 'paid');
  const receivable = open.filter((d) => d.direction === 'receivable').reduce((sum, d) => sum + debtRemaining(d), 0);
  const payable = open.filter((d) => d.direction === 'payable').reduce((sum, d) => sum + debtRemaining(d), 0);
  const debtList = open.slice(0, 10).map((d, i) => `${i + 1}. ${d.direction === 'receivable' ? 'me deben' : 'yo debo'} ${formatCOP(debtRemaining(d))} | ${d.personName} | ${d.description}`).join('\n');
  return [
    `Cuentas disponibles: ${accounts.map((account) => `${account.name} (${formatCOP(account.currentBalance || 0)})`).join(', ') || 'sin cuentas'}`,
    `Resumen del mes: ingresos ${formatCOP(summary.totalIncome)}, gastos ${formatCOP(summary.totalExpenses)}, balance ${formatCOP(summary.balance)}`,
    `Movimientos recientes para consultar, razonar o solicitar confirmación antes de borrar/corregir:\n${recent.length ? recent.join('\n') : 'sin movimientos recientes'}`,
    `Deudas abiertas: ${open.length}\nMe deben: ${formatCOP(receivable)}\nYo debo: ${formatCOP(payable)}\n${debtList || 'sin deudas abiertas'}`,
  ].join('\n\n');
}

async function callVercelDeepSeek(actionPayload: Record<string, unknown>, token: string): Promise<VercelBotAction> {
  const response = await fetch('/api/deepseek-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(actionPayload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details || data?.error || `HTTP ${response.status}`;
    const error: any = new Error(String(detail));
    error.code = response.status === 401 ? 'functions/unauthenticated' : 'deepseek/vercel-api';
    error.details = data;
    throw error;
  }
  if (!data?.action?.replyToUser) {
    const error: any = new Error('DeepSeek V4 Pro no devolvió una acción válida.');
    error.code = 'deepseek/vercel-api';
    error.details = data;
    throw error;
  }
  return data.action as VercelBotAction;
}

async function findTransactionToDelete(uid: string, botAction: VercelBotAction, message: string): Promise<Transaction | null> {
  const transactions = await getTransactions(uid, 50);
  if (transactions.length === 0) return null;
  const target = botAction.deleteTarget || {};
  const requestedAmount = target.amount ? botAmountToNumber(target.amount) : normalizeAmount(message);
  const requestedType = target.type || inferTransactionType(message);
  const scope = target.scope || (requestedType === 'income' ? 'last_income' : requestedType === 'expense' ? 'last_expense' : 'last');
  if (scope === 'last_income') return transactions.find((tx) => tx.type === 'income') || null;
  if (scope === 'last_expense') return transactions.find((tx) => tx.type === 'expense') || null;
  if (scope === 'amount_match' || requestedAmount > 0) return transactions.find((tx) => Math.abs(Number(tx.amount || 0) - requestedAmount) < 1 && (requestedType ? tx.type === requestedType : true)) || null;
  return transactions[0] || null;
}

async function findTransactionToUpdate(uid: string, botAction: VercelBotAction, message: string): Promise<Transaction | null> {
  return findTransactionToDelete(uid, { ...botAction, deleteTarget: botAction.updateTarget || botAction.deleteTarget }, message);
}

async function findDebtForBot(uid: string, botAction: VercelBotAction): Promise<Debt | null> {
  const debts = (await getDebts(uid, 100)).filter((d) => d.status !== 'paid');
  const payment = botAction.debtPayment || {};
  const direction = payment.direction || null;
  return debts.find((d) => (direction ? d.direction === direction : true) && personMatch(d, payment.personName)) || debts[0] || null;
}

async function buildPendingAction(uid: string, botAction: VercelBotAction, message: string): Promise<PendingAction | null> {
  if (botAction.intent === 'delete_transaction' || looksLikeDeleteRequest(message)) {
    const tx = await findTransactionToDelete(uid, botAction, message);
    if (!tx) return null;
    const label = tx.type === 'income' ? 'ingreso' : 'gasto';
    return { id: crypto.randomUUID(), intent: 'delete_transaction', botAction, message, target: tx, summaryText: `Borrar ${label} de ${formatCOP(tx.amount)}: ${tx.description}.` };
  }
  if (botAction.intent === 'update_transaction') {
    const tx = await findTransactionToUpdate(uid, botAction, message);
    if (!tx) return null;
    const patch = botAction.transactionUpdate || {};
    const newAmount = botAmountToNumber(patch.amount);
    return { id: crypto.randomUUID(), intent: 'update_transaction', botAction, message, target: tx, summaryText: `Corregir ${tx.type === 'income' ? 'ingreso' : 'gasto'} “${tx.description}”${newAmount > 0 ? ` a ${formatCOP(newAmount)}` : ''}${patch.category ? `, categoría ${patch.category}` : ''}${patch.description ? `, descripción ${patch.description}` : ''}.` };
  }
  if (botAction.intent === 'register_debt_payment' || botAction.intent === 'close_debt') {
    const debt = await findDebtForBot(uid, botAction);
    if (!debt) return null;
    const amount = botAmountToNumber(botAction.debtPayment?.amount ?? 0);
    const text = botAction.intent === 'close_debt' ? `Marcar como pagada la deuda con ${debt.personName} por ${formatCOP(debtRemaining(debt))}.` : `Registrar abono/pago de ${formatCOP(amount)} en la deuda con ${debt.personName}.`;
    return { id: crypto.randomUUID(), intent: botAction.intent as DangerousIntent, botAction, message, target: debt, summaryText: text };
  }
  return null;
}

async function executePendingAction(uid: string, pending: PendingAction): Promise<string> {
  if (pending.intent === 'delete_transaction') {
    const tx = pending.target as Transaction;
    await deleteTransaction(uid, tx.id);
    await addActionLog(uid, { action: 'delete_transaction', entityType: 'transaction', entityId: tx.id, description: `Borró ${tx.type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(tx.amount)}: ${tx.description}`, before: tx, source: 'bot', status: 'executed' });
    return `Confirmado. Borré el ${tx.type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(tx.amount)} (${tx.description}). Puedes escribir “deshacer” para restaurarlo.`;
  }
  if (pending.intent === 'update_transaction') {
    const tx = pending.target as Transaction;
    const patch = pending.botAction.transactionUpdate || {};
    const newAmount = botAmountToNumber(patch.amount);
    const after = { amount: newAmount > 0 ? newAmount : tx.amount, category: patch.category || tx.category, description: patch.description || tx.description };
    await updateTransaction(uid, tx.id, after as any);
    await addActionLog(uid, { action: 'update_transaction', entityType: 'transaction', entityId: tx.id, description: `Corrigió movimiento ${tx.description}`, before: tx, after, source: 'bot', status: 'executed' });
    return `Confirmado. Corregí el movimiento “${tx.description}”${newAmount > 0 ? ` a ${formatCOP(newAmount)}` : ''}.`;
  }
  const debt = pending.target as Debt;
  if (pending.intent === 'close_debt') {
    const after = { amountPaid: debt.amountOriginal, status: 'paid' as const, closedAt: new Date() };
    await updateDebt(uid, debt.id, after);
    await addActionLog(uid, { action: 'close_debt', entityType: 'debt', entityId: debt.id, description: `Marcó como pagada la deuda con ${debt.personName}`, before: debt, after, source: 'bot', status: 'executed' });
    return `Confirmado. Marqué como pagada la deuda con ${debt.personName}.`;
  }
  const amount = botAmountToNumber(pending.botAction.debtPayment?.amount ?? 0);
  if (amount <= 0) return 'No pude registrar el abono porque faltó el valor exacto.';
  await registerDebtPayment(uid, debt.id, amount);
  await addActionLog(uid, { action: 'register_debt_payment', entityType: 'debt', entityId: debt.id, description: `Registró abono de ${formatCOP(amount)} en deuda con ${debt.personName}`, before: debt, after: { amount }, source: 'bot', status: 'executed' });
  return `Confirmado. Registré el abono de ${formatCOP(amount)} en la deuda con ${debt.personName}.`;
}

async function runVercelDeepSeekChat(uid: string, message: string, imageData: { base64: string; mime: string } | null, currentMessages: ChatMessage[], token: string): Promise<PendingAction | null> {
  await addChatMessage(uid, { text: message, sender: 'user' });
  const accounts = await ensureLocalAccounts(uid);
  const currentSummary = await getLocalMonthlySummary(uid);
  const recentTransactions = await getTransactions(uid, 80);
  const debts = await getDebts(uid, 50).catch(() => [] as Debt[]);
  const context = buildVercelContext(accounts, currentSummary, recentTransactions, debts);
  const botAction = await callVercelDeepSeek({ message, imageBase64: imageData?.base64, imageMimeType: imageData?.mime, context, chatHistory: currentMessages.slice(-20) }, token);

  if (['delete_transaction', 'update_transaction', 'register_debt_payment', 'close_debt'].includes(botAction.intent) || looksLikeDeleteRequest(message)) {
    const pending = await buildPendingAction(uid, botAction, message);
    if (!pending) {
      await addChatMessage(uid, { text: 'Entendí que quieres modificar datos, pero no encontré un objetivo claro. Dime el valor, persona o movimiento exacto.', sender: 'bot', emotionalTone: 'alert', intent: botAction.intent } as any);
      return null;
    }
    await addActionLog(uid, { action: pending.intent, entityType: pending.intent.includes('debt') || pending.intent === 'close_debt' ? 'debt' : 'transaction', entityId: pending.target?.id, description: `Pendiente de confirmación: ${pending.summaryText}`, before: pending.target, source: 'bot', status: 'pending' });
    await addChatMessage(uid, { text: `Antes de tocar tus datos necesito confirmación. ${pending.summaryText}\n\nResponde “confirmo” para ejecutar o “cancelar” para no hacer nada.`, sender: 'bot', emotionalTone: 'alert', intent: botAction.intent } as any);
    return pending;
  }

  let replyToUser = botAction.replyToUser;
  let transactionId: string | undefined;
  let debtId: string | undefined;
  let summary: FinancialSummary | undefined;

  if (botAction.intent === 'create_transaction' && botAction.transaction && (botAction.confidence ?? 0) >= 0.65) {
    const tx = botAction.transaction;
    const amount = botAmountToNumber(tx.amount);
    const type = tx.type || inferTransactionType(message);
    const account = accounts.find((item) => normalizeText(item.name) === normalizeText(tx.accountName || '')) || accounts.find((item) => normalizeText(item.name) === 'efectivo') || accounts[0];
    if (!type || !amount || amount <= 0 || !account) replyToUser = 'Entendí la intención, pero falta un dato para guardarlo bien. Dime si es ingreso o gasto y el valor exacto.';
    else {
      const created = await addTransaction(uid, { type, amount, currency: 'COP', category: tx.category || inferCategory(message, type), accountId: account.id, accountName: account.name, description: tx.description || inferDescription(message), date: botDateToDate(tx.date), rawText: message, source: 'bot', confidence: botAction.confidence ?? 0.95 });
      transactionId = created.id;
      summary = await getLocalMonthlySummary(uid);
      await addActionLog(uid, { action: 'create_transaction', entityType: 'transaction', entityId: created.id, description: `Registró ${type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(amount)}`, after: { type, amount, category: tx.category }, source: 'bot', status: 'executed' });
      replyToUser = replyToUser || `Listo, registré ${type === 'income' ? 'un ingreso' : 'un gasto'} de ${formatCOP(amount)}.`;
    }
  }

  if (botAction.intent === 'create_debt' && botAction.debt && (botAction.confidence ?? 0) >= 0.65) {
    const d = botAction.debt;
    const amount = botAmountToNumber(d.amount);
    if (!d.direction || !d.personName || amount <= 0) replyToUser = 'Entendí que quieres guardar una deuda, pero falta quién debe o el valor exacto.';
    else {
      const created = await addDebt(uid, { direction: d.direction, personName: d.personName.trim(), amountOriginal: amount, amountPaid: 0, currency: 'COP', description: d.description || (d.direction === 'receivable' ? 'Plata prestada' : 'Deuda por pagar'), notes: d.notes || undefined, dueDate: botOptionalDate(d.dueDate), status: 'open', source: 'bot', confidence: botAction.confidence ?? 0.95, closedAt: null });
      debtId = created.id;
      await addActionLog(uid, { action: 'create_debt', entityType: 'debt', entityId: created.id, description: `Registró deuda de ${formatCOP(amount)} con ${d.personName}`, after: d, source: 'bot', status: 'executed' });
      replyToUser = d.direction === 'receivable' ? `Listo, guardé que ${d.personName} te debe ${formatCOP(amount)}.` : `Listo, guardé que debes ${formatCOP(amount)} a ${d.personName}.`;
    }
  }

  if (botAction.intent === 'query_debts') {
    const open = (await getDebts(uid, 100)).filter((d) => d.status !== 'paid');
    const receivable = open.filter((d) => d.direction === 'receivable').reduce((sum, d) => sum + debtRemaining(d), 0);
    const payable = open.filter((d) => d.direction === 'payable').reduce((sum, d) => sum + debtRemaining(d), 0);
    replyToUser = `Deudas abiertas: ${open.length}\nMe deben: ${formatCOP(receivable)}\nYo debo: ${formatCOP(payable)}`;
  }

  if (botAction.intent === 'query_summary') {
    summary = await getLocalMonthlySummary(uid);
    replyToUser = `Te leo los datos reales: este mes llevas ${formatCOP(summary.totalIncome)} en ingresos y ${formatCOP(summary.totalExpenses)} en gastos. Tu balance neto va en ${formatCOP(summary.balance)}. ${summary.balance >= 0 ? 'Vas con margen; la jugada inteligente es separar ahorro antes de seguir gastando.' : 'Estás en negativo; la prioridad es cortar fugas pequeñas y revisar gastos variables hoy mismo.'}`;
  }

  await addChatMessage(uid, { text: replyToUser, sender: 'bot', emotionalTone: botAction.emotionalTone || 'encouraging', suggestedNextQuestion: botAction.suggestedNextQuestion || '', transactionId, debtId, summary, intent: botAction.intent } as any);
  return null;
}

export function ChatPage({ embedded = false }: ChatPageProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chatError, setChatError] = useState<ChatErrorState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/chatMessages`), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ChatMessage)).reverse()));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, isTyping, pendingAction]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setChatError({ friendly: 'Por favor selecciona una imagen válida.', code: 'imagen-invalida' }); return; }
    if (file.size > 8 * 1024 * 1024) { setChatError({ friendly: 'La imagen es demasiado grande. Intenta con una de menos de 8MB.', code: 'imagen-pesada' }); return; }
    setChatError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height;
        const maxDim = 1280;
        if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
        else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        setSelectedImage({ base64: compressedBase64.split(',')[1], mime: 'image/jpeg', preview: compressedBase64 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUndo = async () => {
    if (!user) return;
    const restored = await restoreLastDeletedTransaction(user.uid);
    if (restored) {
      await addActionLog(user.uid, { action: 'restore_transaction', entityType: 'transaction', entityId: restored.id, description: `Restauró ${restored.type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(restored.amount)}: ${restored.description}`, after: restored, source: 'bot', status: 'executed' });
      await addChatMessage(user.uid, { text: `Listo, restauré el ${restored.type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`, sender: 'bot', emotionalTone: 'encouraging' } as any);
    } else await addChatMessage(user.uid, { text: 'No encontré movimientos borrados para restaurar.', sender: 'bot', emotionalTone: 'neutral' } as any);
  };

  const confirmPendingAction = async () => {
    if (!user || !pendingAction) return;
    const reply = await executePendingAction(user.uid, pendingAction);
    setPendingAction(null);
    await addChatMessage(user.uid, { text: reply, sender: 'bot', emotionalTone: 'encouraging' } as any);
  };

  const cancelPendingAction = async () => {
    if (!user || !pendingAction) return;
    await addActionLog(user.uid, { action: pendingAction.intent, entityType: pendingAction.intent.includes('debt') || pendingAction.intent === 'close_debt' ? 'debt' : 'transaction', entityId: pendingAction.target?.id, description: `Canceló acción pendiente: ${pendingAction.summaryText}`, before: pendingAction.target, source: 'bot', status: 'cancelled' });
    setPendingAction(null);
    await addChatMessage(user.uid, { text: 'Cancelado. No hice ningún cambio en tus datos.', sender: 'bot', emotionalTone: 'neutral' } as any);
  };

  const handleSend = async (text: string = input) => {
    const messageText = text.trim();
    if (!messageText && !selectedImage) return;
    if (loading) return;
    if (!user || !auth.currentUser) { setChatError({ friendly: 'Tu sesión no está activa. Cierra sesión y vuelve a entrar.', code: 'functions/unauthenticated' }); return; }
    const finalMessage = messageText || 'Analiza esta imagen y dime si hay un gasto o ingreso para registrar.';
    setInput('');
    const imageData = selectedImage;
    setSelectedImage(null);
    setLoading(true);
    setIsTyping(true);
    setChatError(null);
    try {
      if (pendingAction && isConfirmText(finalMessage)) { await addChatMessage(user.uid, { text: finalMessage, sender: 'user' }); await confirmPendingAction(); return; }
      if (pendingAction && isCancelText(finalMessage)) { await addChatMessage(user.uid, { text: finalMessage, sender: 'user' }); await cancelPendingAction(); return; }
      if (isUndoText(finalMessage)) { await addChatMessage(user.uid, { text: finalMessage, sender: 'user' }); await handleUndo(); return; }
      const token = await auth.currentUser.getIdToken(true);
      const pending = await runVercelDeepSeekChat(user.uid, finalMessage, imageData ? { base64: imageData.base64, mime: imageData.mime } : null, messages, token);
      setPendingAction(pending);
    } catch (error: any) {
      console.error('Chat error full:', { code: error?.code, message: error?.message, details: error?.details, raw: error });
      setChatError(getFriendlyChatError(error));
    } finally {
      setLoading(false);
      setIsTyping(false);
    }
  };

  return (
    <div className={`flex flex-col h-full min-h-0 bg-slate-900/40 relative ${embedded ? '' : 'max-w-5xl mx-auto w-full glass rounded-3xl overflow-hidden shadow-2xl'}`}>
      <div className="px-4 sm:px-6 py-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20"><Bot className="w-6 h-6 text-white" /></div>
          <div><h2 className="text-sm font-bold text-slate-100">Tu Asistente Financiero</h2><div className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-full ${isTyping ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} /><span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{isTyping ? 'Escribiendo...' : pendingAction ? 'Esperando confirmación' : 'En línea'}</span></div></div>
        </div>
        <ShieldCheck className="h-5 w-5 text-green-400" />
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 custom-scrollbar">
        {messages.length === 0 && !isTyping && <div className="flex flex-col items-center justify-center h-full text-center p-8"><div className="w-16 h-16 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-4 border border-slate-700/50"><Bot className="w-8 h-8 text-blue-400" /></div><h3 className="text-slate-200 font-semibold">¡Hola! Soy tu asistente financiero</h3><p className="text-slate-500 text-sm mt-2 max-w-xs">Registro ingresos, gastos, deudas, abonos y análisis. Antes de borrar o corregir siempre pediré confirmación.</p></div>}
        {messages.map((msg) => <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}><div className={`max-w-[92%] sm:max-w-[85%] whitespace-pre-line px-4 py-2.5 rounded-2xl text-sm shadow-sm ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-100 border border-slate-700/50 rounded-tl-none'}`}>{msg.text}</div>{msg.sender === 'bot' && (msg.transactionId || msg.debtId) && <div className="w-full max-w-[92%] sm:max-w-[85%] mt-2 space-y-2">{msg.transactionId && <div className="rounded-2xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-100 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Movimiento registrado</div>}{msg.debtId && <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Deuda actualizada</div>}</div>}</div>)}
        {pendingAction && <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-50 shadow-lg"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-amber-300" /><div><p className="text-sm font-bold">Confirmación requerida</p><p className="mt-1 text-sm text-amber-100">{pendingAction.summaryText}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={confirmPendingAction} disabled={loading} className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50">Confirmar</button><button onClick={cancelPendingAction} disabled={loading} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-50">Cancelar</button></div></div>}
        {isTyping && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Pensando con tus datos...</div>}
      </div>

      {chatError && <div className="mx-3 sm:mx-5 mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"><div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> {chatError.friendly}</div>{chatError.message && <p className="mt-1 text-xs text-red-200/80">{chatError.message}</p>}{chatError.details && <pre className="mt-2 max-h-28 overflow-auto text-[10px] text-red-200/70 whitespace-pre-wrap">{chatError.details}</pre>}</div>}
      {selectedImage && <div className="mx-3 sm:mx-5 mb-3 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/80 p-2"><img src={selectedImage.preview} alt="Imagen seleccionada" className="h-14 w-14 rounded-xl object-cover" /><span className="flex-1 text-sm text-slate-300">Imagen lista para analizar</span><button onClick={() => setSelectedImage(null)} className="rounded-full p-2 text-slate-400 hover:bg-slate-700"><X className="h-4 w-4" /></button></div>}

      <div className="border-t border-slate-700/50 bg-slate-950/70 p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{['cómo voy este mes', 'analiza mis fugas de dinero', 'quién me debe plata', 'cuánto debo', 'deshacer'].map((quick) => <button key={quick} onClick={() => handleSend(quick)} className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{quick}</button>)}</div>
        <div className="flex items-end gap-2"><input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} /><button onClick={() => fileInputRef.current?.click()} className="rounded-2xl border border-slate-700 p-3 text-slate-300 hover:bg-slate-800" aria-label="Adjuntar imagen"><Camera className="h-5 w-5" /></button><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={pendingAction ? 'Escribe confirmo o cancelar...' : 'Ej: me gasté 15 mil en café'} rows={1} className="max-h-32 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" /><button onClick={() => handleSend()} disabled={loading || (!input.trim() && !selectedImage)} className="rounded-2xl bg-blue-600 p-3 text-white hover:bg-blue-500 disabled:opacity-40"><Send className="h-5 w-5" /></button></div>
        <button onClick={handleUndo} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"><RotateCcw className="h-3.5 w-3.5" /> Restaurar último borrado</button>
      </div>
    </div>
  );
}
