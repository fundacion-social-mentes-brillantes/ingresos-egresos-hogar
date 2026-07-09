import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AlertCircle, Bot, CheckCircle2, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { auth, db } from '../lib/firebase';
import { addActionLog, addChatMessage, assignOrphanMessagesToThread, deleteConversationMessages, getAccounts, getAllTransactions, getBudgets, getChatThreads, getDebts, getTransactions, getTransactionsByRange, saveChatThreads } from '../lib/firestore';
import { correctAccountingTransaction, createAccountingTransaction, reverseAccountingTransaction, reverseTransfer } from '../lib/accountingOperations';
import { transferBetweenAccountsSafe } from '../lib/transferOperations';
import { createDebtWithMoneyMovement, registerDebtPaymentWithMoneyMovement } from '../lib/debtMoney';
import { buildAccountingLedger, buildFinancialSummaryForPeriod, isExternalAccount, personalTransactions, summarizeDebts, toMoney } from '../lib/accounting';
import { buildMonthlyReport } from '../lib/reporting';
import { classifyChatAccountingTarget } from '../lib/chatAccountingSafety';
import { parseSafeChatAmount } from '../lib/safeMoney';
import { getAiMemory, memoryToContext, updateAiMemory } from '../lib/aiMemory';
import { EmptyState } from '../components/visual/EmptyState';
import type { Account, AiInsight, AiMemoryProfile, ChatMessage, ChatThread, Debt, DebtDirection, FinancialSummary, Transaction, TransactionType } from '../types';
import { formatCOP } from '../types';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { es } from 'date-fns/locale';

type ChatPageProps = { embedded?: boolean };
type DangerousIntent = 'delete_transaction' | 'update_transaction' | 'register_debt_payment' | 'close_debt';

type BotActionPro = {
  intent: string;
  replyToUser: string;
  transaction?: { type?: TransactionType; amount?: number | string; category?: string; accountName?: string; description?: string; date?: string };
  debt?: { direction?: DebtDirection; personName?: string; amount?: number | string; accountName?: string; description?: string; notes?: string; dueDate?: string | null };
  debtPayment?: { direction?: DebtDirection | null; personName?: string; amount?: number | string | null; accountName?: string; scope?: 'last' | 'person_match' | 'amount_match' };
  deleteTarget?: { scope?: 'last' | 'last_income' | 'last_expense' | 'amount_match'; type?: TransactionType | null; amount?: number | string | null };
  updateTarget?: { scope?: 'last' | 'last_income' | 'last_expense' | 'amount_match'; type?: TransactionType | null; amount?: number | string | null };
  transactionUpdate?: { amount?: number | string | null; category?: string; description?: string };
  confidence?: number;
  assistantMode?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  insights?: AiInsight[];
  suggestedActions?: string[];
  suggestedNextQuestion?: string;
  memoryPatch?: Partial<AiMemoryProfile>;
};

type PendingAction = {
  id: string;
  intent: DangerousIntent;
  botAction: BotActionPro;
  message: string;
  summaryText: string;
  target?: Transaction | Debt | null;
  account?: Account | null;
};

type ChatErrorState = { friendly: string; code?: string; message?: string; details?: string };

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isConfirmText(message: string): boolean {
  return ['si', 'sí', 'confirmo', 'confirmar', 'dale', 'hazlo', 'acepto', 'ok'].includes(normalizeText(message));
}

function isCancelText(message: string): boolean {
  return ['no', 'cancelar', 'cancela', 'no hagas nada', 'dejalo', 'déjalo'].includes(normalizeText(message));
}

function looksLikeDeleteRequest(message: string): boolean {
  const text = normalizeText(message);
  // Palabras completas (\b), no subcadenas: antes "me quitaron 30 mil" disparaba
  // el flujo de borrado por contener "quita". normalizeText ya quito acentos.
  return /\b(borra|borrar|borralo|borrala|elimina|eliminar|eliminalo|eliminala|quita|quitar|quitalo|quitala|anula|anular|analo)\b/.test(text);
}

function hasAmountValue(value: number | string | null | undefined): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function parseRequiredBotAmount(value: number | string | null | undefined): number {
  if (!hasAmountValue(value)) return 0;
  const amount = parseSafeChatAmount(value);
  if (amount <= 0) throw new Error('El valor debe ser mayor que cero.');
  return amount;
}

function parseBotAmount(value: number | string | null | undefined): number {
  if (!hasAmountValue(value)) return 0;
  try {
    return parseRequiredBotAmount(value);
  } catch {
    return 0;
  }
}

function toDateFromBot(value?: string): Date {
  if (!value || value === 'today') return new Date();
  if (value === 'yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function optionalDateFromBot(value?: string | null): Date | null {
  if (!value) return null;
  if (value === 'today') return new Date();
  if (value === 'tomorrow') {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date;
  }
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function accountOptionsText(accounts: Account[]): string {
  return accounts.length ? accounts.map((account) => account.name).join(', ') : 'no hay cuentas creadas';
}

function resolveAccount(accounts: Account[], rawMessage: string, proposedName?: string): Account | null {
  const active = accounts.filter((account) => account.active !== false);
  if (!active.length) return null;
  const text = normalizeText(rawMessage);
  const exactMention = active.filter((account) => text.includes(normalizeText(account.name)));
  if (exactMention.length === 1) return exactMention[0];
  if (exactMention.length > 1) return null;
  const proposed = active.find((account) => normalizeText(account.name) === normalizeText(proposedName));
  if (active.length === 1 && proposed) return proposed;
  return null;
}

function inferTypeFromMessage(message: string): TransactionType | null {
  const text = normalizeText(message);
  const income = ['me entro', 'entraron', 'recibi', 'recibo', 'me pagaron', 'cobre', 'cobro', 'me consignaron', 'me depositaron', 'vendi', 'venta', 'ingrese', 'ingresa', 'ingreso', 'sueldo', 'salario'];
  const expense = ['me gaste', 'gaste', 'gasto', 'egreso', 'compre', 'compra', 'pague', 'pago', 'almorce', 'recargue', 'tanquie'];
  if (income.some((word) => text.includes(word))) return 'income';
  if (expense.some((word) => text.includes(word))) return 'expense';
  return null;
}

function fallbackDescription(message: string, type: TransactionType): string {
  const text = message.replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '').replace(/\s+/g, ' ').trim();
  return text || (type === 'income' ? 'Ingreso registrado desde el chat' : 'Gasto registrado desde el chat');
}

function debtRemaining(debt: Debt): number {
  return Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid));
}

function personMatch(debt: Debt, name?: string): boolean {
  if (!name) return true;
  const a = normalizeText(debt.personName);
  const b = normalizeText(name);
  return a.includes(b) || b.includes(a);
}

function normalizeMessage(id: string, data: Record<string, any>): ChatMessage {
  const createdAt = data.createdAt && typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate() : new Date();
  return { id, ...data, createdAt } as ChatMessage;
}

async function getLocalMonthlySummary(uid: string): Promise<FinancialSummary> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const [txs, accounts] = await Promise.all([getTransactionsByRange(uid, start, end), getAccounts(uid).catch(() => [])]);
  return buildFinancialSummaryForPeriod(personalTransactions(txs, accounts), start, end, 'this_month');
}

function monthLabel(date: Date): string {
  const raw = format(date, 'LLLL yyyy', { locale: es });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Construye un panorama financiero COMPLETO para que la IA conozca toda la
// situacion: patrimonio, cuentas con conciliacion, categorias del mes, tendencia
// de los ultimos meses, deudas y el diagnostico ya calculado por la app. Usa el
// historial completo (getAllTransactions), no solo lo reciente.
async function buildFinancialContext(uid: string) {
  const [accounts, debts, allTx, budgets] = await Promise.all([
    getAccounts(uid),
    getDebts(uid, 200).catch(() => [] as Debt[]),
    getAllTransactions(uid).catch(() => [] as Transaction[]),
    getBudgets(uid).catch(() => ({} as Record<string, number>)),
  ]);

  const now = new Date();
  // Los totales personales (mes, tendencia, categorias, recientes) excluyen los
  // movimientos de cuentas AJENAS: es dinero de terceros, no del usuario.
  const personalTx = personalTransactions(allTx, accounts);
  const summary = buildFinancialSummaryForPeriod(personalTx, startOfMonth(now), endOfMonth(now), 'this_month');
  const ledger = buildAccountingLedger(accounts, allTx, debts);
  const report = buildMonthlyReport(personalTx, debts);
  const debtSummary = summarizeDebts(debts);

  const accountLines = accounts.map((account) => {
    const stats = ledger.byAccount[account.id];
    const saldo = stats ? stats.saldoFisicoCalculado : toMoney(account.currentBalance || 0);
    const estado = !stats ? '' : stats.saldoRealConfirmado ? (stats.estado === 'cuadra' ? ' | cuadra' : ` | descuadre ${formatCOP(Math.abs(stats.diferenciaConciliacion))}`) : ' | sin conciliar';
    const ajena = isExternalAccount(account) ? ' | AJENA: dinero de terceros, NO es del usuario' : '';
    return `- ${account.name}${account.active === false ? ' (inactiva)' : ''}: ${formatCOP(saldo)}${estado}${ajena}`;
  }).join('\n');

  const catLines = Object.entries(summary.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, value]) => `- ${cat}: ${formatCOP(value)}`)
    .join('\n');

  const trendLines = Array.from({ length: 6 }, (_, i) => 5 - i)
    .map((back) => {
      const ref = subMonths(now, back);
      const periodo = buildFinancialSummaryForPeriod(personalTx, startOfMonth(ref), endOfMonth(ref), 'custom');
      return `- ${monthLabel(ref)}: ingresos ${formatCOP(periodo.totalIncome)}, gastos ${formatCOP(periodo.totalExpenses)}, balance ${formatCOP(periodo.balance)}`;
    })
    .join('\n');

  const openDebts = debts.filter((debt) => debt.status !== 'paid' && !debt.isReversed);
  const debtList = openDebts
    .slice(0, 20)
    .map((debt, index) => `${index + 1}. ${debt.direction === 'receivable' ? 'me deben' : 'yo debo'} ${formatCOP(debtRemaining(debt))} | ${debt.personName} | ${debt.description}`)
    .join('\n');

  const recent = [...personalTx]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 50)
    .map((tx, index) => `${index + 1}. ${tx.date.toLocaleDateString('es-CO')} | ${tx.type === 'income' ? 'ingreso' : 'gasto'} ${formatCOP(toMoney(tx.amount))} | ${tx.category} | ${tx.description} | ${tx.accountName}`)
    .join('\n');

  const ajenoLine = ledger.global.valorTotalAjeno
    ? `DINERO AJENO CUSTODIADO: ${formatCOP(ledger.global.valorTotalAjeno)} en ${ledger.global.cuentasAjenas} cuenta(s) ajena(s). Esto NO es del usuario; NO lo sumes a su patrimonio ni lo cuentes como sus ingresos/gastos.`
    : '';

  const context = [
    `PATRIMONIO GLOBAL: neto ${formatCOP(ledger.global.patrimonioNeto)} (liquido ${formatCOP(ledger.global.valorTotalLiquido)} + te deben ${formatCOP(debtSummary.receivable)} - tu debes ${formatCOP(debtSummary.payable)}). Cuentas propias activas: ${ledger.global.cuentasActivas}.`,
    ajenoLine,
    `CUENTAS (saldo y conciliacion):\n${accountLines || 'sin cuentas'}`,
    `MES ACTUAL (${monthLabel(now)}): ingresos ${formatCOP(summary.totalIncome)}, gastos ${formatCOP(summary.totalExpenses)}, balance ${formatCOP(summary.balance)}.`,
    `GASTOS DEL MES POR CATEGORIA:\n${catLines || 'sin gastos este mes'}`,
    `DEUDAS ABIERTAS (te deben ${formatCOP(debtSummary.receivable)} en total, tu debes ${formatCOP(debtSummary.payable)} en total):\n${debtList || 'sin deudas abiertas'}`,
    `MOVIMIENTOS RECIENTES (ultimos 50 de ${personalTx.length} propios):\n${recent || 'sin movimientos'}`,
  ].filter(Boolean).join('\n\n');

  const budgetLines = Object.entries(budgets)
    .map(([cat, limit]) => {
      const spent = summary.byCategory[cat] || 0;
      const estado = spent > limit ? `SE PASO por ${formatCOP(spent - limit)}` : `quedan ${formatCOP(limit - spent)}`;
      return `- ${cat}: gastado ${formatCOP(spent)} de ${formatCOP(limit)} (${estado})`;
    })
    .join('\n');

  const diagnosticContext = [
    `Tasa de ahorro de este mes: ${Number.isFinite(report.savingsRate) ? report.savingsRate.toFixed(1) : '0'}%.`,
    budgetLines ? `PRESUPUESTOS POR CATEGORIA (topes que el usuario definio; son solo aviso, no limite):\n${budgetLines}` : '',
    report.topCategory ? `Categoria de mayor gasto este mes: ${report.topCategory[0]} (${formatCOP(report.topCategory[1])}).` : '',
    `TENDENCIA ULTIMOS 6 MESES:\n${trendLines}`,
    report.alerts.length ? `ALERTAS DETECTADAS:\n- ${report.alerts.join('\n- ')}` : 'Sin alertas fuertes este mes.',
    report.opportunities.length ? `OPORTUNIDADES:\n- ${report.opportunities.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');

  return { accounts, debts, summary, context, diagnosticContext };
}

async function callDeepSeek(payload: Record<string, unknown>, token: string): Promise<BotActionPro> {
  const response = await fetch('/api/deepseek-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(String(data?.details || data?.error || `HTTP ${response.status}`));
    error.code = response.status === 401 ? 'functions/unauthenticated' : 'deepseek/vercel-api';
    error.details = data;
    throw error;
  }
  if (!data?.action?.replyToUser) throw new Error('La IA no devolvió una acción válida.');
  return data.action as BotActionPro;
}

async function findTransaction(uid: string, action: BotActionPro, message: string): Promise<Transaction | null> {
  // No se debe reversar un movimiento ya reversado ni un asiento de reverso:
  // se excluyen para no proponer/ejecutar acciones sobre ellos. Ademas, "el
  // ultimo" se resuelve por ORDEN DE CAPTURA (createdAt), no por fecha del
  // movimiento: si el usuario registro algo con fecha de ayer y dice "borra ese
  // ultimo", debe apuntar a lo que ACABA de escribir, no al de fecha mas nueva.
  const transactions = (await getTransactions(uid, 100))
    .filter((tx) => !tx.isReversed && !tx.reversalOf)
    .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
  const target = action.deleteTarget || action.updateTarget || {};
  const hasTargetAmount = hasAmountValue(target.amount);
  const amount = hasTargetAmount ? parseRequiredBotAmount(target.amount) : 0;
  const type = target.type || inferTypeFromMessage(message);
  if (target.scope === 'last_income') return transactions.find((tx) => tx.type === 'income') || null;
  if (target.scope === 'last_expense') return transactions.find((tx) => tx.type === 'expense') || null;
  if (target.scope === 'amount_match' && !hasTargetAmount) return null;
  if (hasTargetAmount) return transactions.find((tx) => Math.abs(toMoney(tx.amount) - amount) < 1 && (type ? tx.type === type : true)) || null;
  if (type) return transactions.find((tx) => tx.type === type) || null;
  return transactions[0] || null;
}

async function findDebt(uid: string, action: BotActionPro): Promise<Debt | null> {
  const debts = (await getDebts(uid, 100)).filter((debt) => debt.status !== 'paid' && !debt.isReversed);
  const payment = action.debtPayment || {};
  const direction = payment.direction || null;
  const matches = debts.filter((debt) => (direction ? debt.direction === direction : true) && personMatch(debt, payment.personName));
  // Si el nombre casa con deudas de PERSONAS DISTINTAS (p.ej. "Ana" y "Ana
  // Maria") no adivinamos: devolvemos null para que el bot pida aclaracion en
  // vez de abonar a la deuda equivocada.
  if (matches.length > 1 && new Set(matches.map((debt) => normalizeText(debt.personName))).size > 1) return null;
  return matches[0] || null;
}

async function buildPendingAction(uid: string, action: BotActionPro, message: string, accounts: Account[]): Promise<PendingAction | null> {
  if (action.intent === 'delete_transaction' || looksLikeDeleteRequest(message)) {
    const tx = await findTransaction(uid, action, message);
    if (!tx) return null;
    const decision = classifyChatAccountingTarget(tx, 'delete_transaction');
    if (decision.mode === 'blocked') throw new Error(decision.reason);
    const summaryText = decision.mode === 'transfer'
      ? `Reversar la transferencia completa de ${formatCOP(tx.amount)}: ${tx.description}.`
      : `Reversar ${tx.type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(tx.amount)}: ${tx.description}.`;
    return { id: crypto.randomUUID(), intent: 'delete_transaction', botAction: action, message, target: tx, summaryText };
  }
  if (action.intent === 'update_transaction') {
    const tx = await findTransaction(uid, action, message);
    if (!tx) return null;
    const decision = classifyChatAccountingTarget(tx, 'update_transaction');
    if (decision.mode === 'blocked') throw new Error(decision.reason);
    const patch = action.transactionUpdate || {};
    const amount = hasAmountValue(patch.amount) ? parseRequiredBotAmount(patch.amount) : tx.amount;
    const summaryText = decision.mode === 'transfer'
      ? `Reversar y recrear la transferencia completa ${tx.description} con valor ${formatCOP(amount)}.`
      : `Reversar y recrear ${tx.description} con valor ${formatCOP(amount)}.`;
    return { id: crypto.randomUUID(), intent: 'update_transaction', botAction: action, message, target: tx, summaryText };
  }
  if (action.intent === 'register_debt_payment' || action.intent === 'close_debt') {
    const debt = await findDebt(uid, action);
    if (!debt) return null;
    const account = resolveAccount(accounts, message, action.debtPayment?.accountName);
    if (!account) throw new Error(`Para registrar el abono necesito la cuenta exacta. Cuentas disponibles: ${accountOptionsText(accounts)}.`);
    const requested = action.intent === 'close_debt' ? debtRemaining(debt) : parseRequiredBotAmount(action.debtPayment?.amount);
    // Mostramos el monto REALMENTE aplicado (no puede superar lo pendiente), que
    // es lo que movera la cuenta; antes el texto podia prometer mas de lo movido.
    const amount = Math.min(debtRemaining(debt), requested);
    return { id: crypto.randomUUID(), intent: action.intent as DangerousIntent, botAction: action, message, target: debt, account, summaryText: `Registrar ${action.intent === 'close_debt' ? 'pago total' : 'abono'} de ${formatCOP(amount)} en la deuda con ${debt.personName}, usando ${account.name}.` };
  }
  return null;
}

async function executePendingAction(uid: string, pending: PendingAction): Promise<string> {
  if (pending.intent === 'delete_transaction') {
    const tx = pending.target as Transaction;
    const decision = classifyChatAccountingTarget(tx, 'delete_transaction');
    if (decision.mode === 'blocked') throw new Error(decision.reason);
    if (decision.mode === 'transfer') {
      await reverseTransfer(uid, decision.transferId, 'Reverso de transferencia solicitado desde chat');
      await addActionLog(uid, { action: 'reverse_transfer_from_chat', entityType: 'transaction', entityId: tx.id, description: `Reverso completo de transferencia ${decision.transferId} desde chat`, before: tx, source: 'bot', status: 'executed' });
      return `Confirmado. Reversé la transferencia completa por ${formatCOP(tx.amount)}. No toqué una sola pata.`;
    }
    await reverseAccountingTransaction(uid, tx.id, 'Reverso solicitado desde chat');
    await addActionLog(uid, { action: 'reverse_transaction', entityType: 'transaction', entityId: tx.id, description: `Reversó ${tx.description} desde chat`, before: tx, source: 'bot', status: 'executed' });
    return `Confirmado. Dejé reverso contable del movimiento ${tx.description} por ${formatCOP(tx.amount)}. No borré historial.`;
  }
  if (pending.intent === 'update_transaction') {
    const tx = pending.target as Transaction;
    const decision = classifyChatAccountingTarget(tx, 'update_transaction');
    if (decision.mode === 'blocked') throw new Error(decision.reason);
    const patch = pending.botAction.transactionUpdate || {};
    const amount = hasAmountValue(patch.amount) ? parseRequiredBotAmount(patch.amount) : tx.amount;
    if (decision.mode === 'transfer') {
      const fromAccountId = tx.transferDirection === 'in' ? tx.transferAccountId : tx.accountId;
      const toAccountId = tx.transferDirection === 'in' ? tx.accountId : tx.transferAccountId;
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) throw new Error('No pude identificar las dos cuentas de la transferencia. Haz la corrección desde Movimientos.');
      await reverseTransfer(uid, decision.transferId, 'Corrección de transferencia solicitada desde chat');
      const created = await transferBetweenAccountsSafe(uid, {
        fromAccountId,
        toAccountId,
        amount,
        description: patch.description || tx.description,
        date: new Date(),
        allowNegativeBalance: true,
      });
      await addActionLog(uid, { action: 'correct_transfer_with_reversal', entityType: 'transaction', entityId: tx.id, description: `Corrigió transferencia ${decision.transferId} con reverso completo`, before: tx, after: { transferId: created.transferId, amount }, source: 'bot', status: 'executed' });
      return `Confirmado. Reversé la transferencia completa y creé la corrección por ${formatCOP(amount)}.`;
    }
    // Correccion ATOMICA (reverso + corregido + saldos en una transaccion) y
    // conservando la fecha ORIGINAL del movimiento para no moverlo de mes.
    const created = await correctAccountingTransaction(uid, tx.id, {
      type: tx.type,
      amount,
      accountId: tx.accountId,
      category: patch.category || tx.category,
      description: patch.description || `Corrección de ${tx.description}`,
      date: tx.date instanceof Date && !Number.isNaN(tx.date.getTime()) ? tx.date : new Date(),
      source: 'bot',
      rawText: pending.message,
    }, 'Corrección solicitada desde chat');
    await addActionLog(uid, { action: 'correct_transaction_with_reversal', entityType: 'transaction', entityId: tx.id, description: `Corrigió ${tx.description} con reverso y nuevo movimiento`, before: tx, after: { newTransactionId: created.id, amount }, source: 'bot', status: 'executed' });
    return `Confirmado. Reversé el movimiento original y creé la corrección por ${formatCOP(amount)}. La trazabilidad quedó conservada.`;
  }
  const debt = pending.target as Debt;
  const account = pending.account as Account;
  const amount = pending.intent === 'close_debt' ? debtRemaining(debt) : parseRequiredBotAmount(pending.botAction.debtPayment?.amount);
  if (amount <= 0) throw new Error('Falta el valor exacto del abono.');
  await registerDebtPaymentWithMoneyMovement(uid, debt.id, amount, account);
  await addActionLog(uid, { action: pending.intent, entityType: 'debt', entityId: debt.id, description: `Registró pago/abono de ${formatCOP(amount)} en deuda con ${debt.personName}`, before: debt, after: { amount, accountId: account.id }, source: 'bot', status: 'executed' });
  return `Confirmado. Registré ${formatCOP(amount)} en la deuda con ${debt.personName} y moví la cuenta ${account.name}.`;
}

async function persistMemory(uid: string, action: BotActionPro) {
  if (!action.memoryPatch) return;
  await updateAiMemory(uid, action.memoryPatch).catch((error) => console.warn('AI memory update failed', error));
}

function friendlyError(error: any): ChatErrorState {
  const code = error?.code || 'chat/error';
  return { friendly: error?.message || 'No pude procesar el mensaje.', code, message: error?.message, details: error?.details ? JSON.stringify(error.details) : undefined };
}

async function runSafeChat(uid: string, message: string, currentMessages: ChatMessage[], token: string, conversationId: string): Promise<PendingAction | null> {
  await addChatMessage(uid, { text: message, sender: 'user', conversationId });
  const { accounts, debts, summary, context, diagnosticContext } = await buildFinancialContext(uid);
  const memory = await getAiMemory(uid).catch(() => ({} as AiMemoryProfile));
  const action = await callDeepSeek({ message, context, diagnosticContext, aiMemory: memoryToContext(memory), chatHistory: currentMessages.slice(-20) }, token);
  await persistMemory(uid, action);

  if (['delete_transaction', 'update_transaction', 'register_debt_payment', 'close_debt'].includes(action.intent) || looksLikeDeleteRequest(message)) {
    const pending = await buildPendingAction(uid, action, message, accounts);
    if (!pending) {
      await addChatMessage(uid, { text: 'Entendí que quieres modificar datos, pero no encontré un objetivo claro. Dime valor, persona, cuenta o movimiento exacto.', sender: 'bot', conversationId } as any);
      return null;
    }
    await addActionLog(uid, { action: pending.intent, entityType: pending.intent.includes('debt') || pending.intent === 'close_debt' ? 'debt' : 'transaction', entityId: pending.target?.id, description: `Pendiente de confirmación: ${pending.summaryText}`, before: pending.target, source: 'bot', status: 'pending' });
    await addChatMessage(uid, { text: `Antes de tocar tus datos necesito confirmación. ${pending.summaryText}\n\nResponde “confirmo” para ejecutar o “cancelar” para no hacer nada.`, sender: 'bot', conversationId, emotionalTone: 'alert', assistantMode: 'registro', riskLevel: 'medium', suggestedActions: ['Confirmar', 'Cancelar'] } as any);
    return pending;
  }

  let replyToUser = action.replyToUser;
  let transactionId: string | undefined;
  let debtId: string | undefined;
  let responseSummary: FinancialSummary | undefined;

  if (action.intent === 'create_transaction' && action.transaction && (action.confidence ?? 0) >= 0.65) {
    const tx = action.transaction;
    const amount = parseBotAmount(tx.amount);
    const type = tx.type || inferTypeFromMessage(message);
    const account = resolveAccount(accounts, message, tx.accountName);
    if (!type || amount <= 0) replyToUser = 'Me falta saber si es ingreso o gasto y el valor exacto.';
    else if (!account) replyToUser = `Para no registrar mal la plata, dime la cuenta exacta. Cuentas disponibles: ${accountOptionsText(accounts)}.`;
    else {
      const created = await createAccountingTransaction(uid, {
        type,
        amount,
        accountId: account.id,
        category: tx.category || (type === 'income' ? 'Ingreso' : 'Otros'),
        description: tx.description || fallbackDescription(message, type),
        date: toDateFromBot(tx.date),
        source: 'bot',
        rawText: message,
        movementKind: type === 'income' ? 'income' : 'expense',
      });
      transactionId = created.id;
      responseSummary = await getLocalMonthlySummary(uid);
      await addActionLog(uid, { action: 'create_accounting_transaction', entityType: 'transaction', entityId: created.id, description: `Registró ${type === 'income' ? 'ingreso' : 'gasto'} de ${formatCOP(amount)} en ${account.name}`, after: { type, amount, accountId: account.id }, source: 'bot', status: 'executed' });
      replyToUser = `Listo. Registré ${type === 'income' ? 'un ingreso' : 'un gasto'} de ${formatCOP(amount)} en ${account.name}.`;
    }
  }

  if (action.intent === 'create_debt' && action.debt && (action.confidence ?? 0) >= 0.65) {
    const debt = action.debt;
    const amount = parseBotAmount(debt.amount);
    const account = resolveAccount(accounts, message, debt.accountName);
    if (!debt.direction || !debt.personName || amount <= 0) replyToUser = 'Entendí que quieres guardar una deuda, pero falta quién debe o el valor exacto.';
    else if (!account) replyToUser = `Para crear esa deuda necesito la cuenta real que se mueve. Cuentas disponibles: ${accountOptionsText(accounts)}.`;
    else {
      const created = await createDebtWithMoneyMovement(uid, {
        direction: debt.direction,
        personName: debt.personName.trim(),
        amountOriginal: amount,
        amountPaid: 0,
        currency: 'COP',
        description: debt.description || (debt.direction === 'receivable' ? 'Plata prestada' : 'Deuda por pagar'),
        notes: debt.notes || null,
        dueDate: optionalDateFromBot(debt.dueDate),
        status: 'open',
        source: 'bot',
        confidence: action.confidence ?? 0.95,
      }, account);
      debtId = created.id;
      await addActionLog(uid, { action: 'create_debt_with_money_movement', entityType: 'debt', entityId: created.id, description: `Registró deuda de ${formatCOP(amount)} con ${debt.personName} y cuenta ${account.name}`, after: debt, source: 'bot', status: 'executed' });
      replyToUser = debt.direction === 'receivable'
        ? `Listo. Registré que ${debt.personName} te debe ${formatCOP(amount)} y desconté la plata de ${account.name}.`
        : `Listo. Registré que debes ${formatCOP(amount)} a ${debt.personName} y sumé la entrada en ${account.name}.`;
    }
  }

  if (action.intent === 'query_debts') {
    const open = debts.filter((debt) => debt.status !== 'paid' && !debt.isReversed);
    const receivable = open.filter((debt) => debt.direction === 'receivable').reduce((sum, debt) => sum + debtRemaining(debt), 0);
    const payable = open.filter((debt) => debt.direction === 'payable').reduce((sum, debt) => sum + debtRemaining(debt), 0);
    replyToUser = action.replyToUser || `Tienes ${open.length} deudas abiertas. Te deben ${formatCOP(receivable)} y tú debes ${formatCOP(payable)}.`;
  }

  if (['query_summary', 'analyze_behavior', 'financial_advice'].includes(action.intent)) {
    responseSummary = summary;
    replyToUser = action.replyToUser || `Este mes vas con ${formatCOP(summary.totalIncome)} en ingresos, ${formatCOP(summary.totalExpenses)} en gastos y balance de ${formatCOP(summary.balance)}.`;
  }

  await addChatMessage(uid, { text: replyToUser, sender: 'bot', conversationId, transactionId, debtId, summary: responseSummary, emotionalTone: action.emotionalTone || 'encouraging', suggestedNextQuestion: action.suggestedNextQuestion || '', assistantMode: action.assistantMode, riskLevel: action.riskLevel, insights: action.insights, suggestedActions: action.suggestedActions, intent: action.intent } as any);
  return null;
}

function newThreadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ChatPage({ embedded = false }: ChatPageProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<ChatErrorState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cargar o inicializar las conversaciones del usuario.
  useEffect(() => {
    if (!user) { setThreads([]); setActiveId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const stored = await getChatThreads(user.uid);
        if (cancelled) return;
        if (stored.threads.length > 0) {
          setThreads(stored.threads);
          setActiveId(stored.activeId && stored.threads.some((t) => t.id === stored.activeId) ? stored.activeId : stored.threads[0].id);
          return;
        }
        const first: ChatThread = { id: newThreadId(), title: 'Chat 1', createdAt: Date.now(), updatedAt: Date.now() };
        setThreads([first]);
        setActiveId(first.id);
        await saveChatThreads(user.uid, { threads: [first], activeId: first.id });
        // Conserva el historial previo (mensajes sin conversationId) en el primer chat.
        await assignOrphanMessagesToThread(user.uid, first.id).catch(() => undefined);
      } catch (error) {
        if (cancelled) return;
        console.error('No pude cargar las conversaciones', error);
        const first: ChatThread = { id: newThreadId(), title: 'Chat 1', createdAt: Date.now(), updatedAt: Date.now() };
        setThreads([first]);
        setActiveId(first.id);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Mensajes de la conversacion activa (filtra por conversationId, orden en cliente).
  useEffect(() => {
    if (!user || !activeId) { setMessages([]); return; }
    setPendingAction(null);
    const q = query(collection(db, `users/${user.uid}/chatMessages`), where('conversationId', '==', activeId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => normalizeMessage(d.id, d.data()));
        list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        setMessages(list);
      },
      (error) => console.error('Listener de mensajes fallo', error)
    );
    return () => unsubscribe();
  }, [user, activeId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pendingAction, loading]);

  const activeThread = threads.find((t) => t.id === activeId) || null;

  const persistThreads = async (next: ChatThread[], nextActive: string | null) => {
    if (!user) return;
    await saveChatThreads(user.uid, { threads: next, activeId: nextActive }).catch((error) => console.error('No pude guardar conversaciones', error));
  };

  const createThread = async () => {
    if (!user) return;
    const thread: ChatThread = { id: newThreadId(), title: `Chat ${threads.length + 1}`, createdAt: Date.now(), updatedAt: Date.now() };
    const next = [thread, ...threads];
    setThreads(next); setActiveId(thread.id); setMessages([]); setPendingAction(null); setChatError(null);
    await persistThreads(next, thread.id);
  };

  const switchThread = async (id: string) => {
    if (id === activeId) return;
    setActiveId(id); setPendingAction(null); setChatError(null);
    await persistThreads(threads, id);
  };

  const renameThread = async (id: string) => {
    const current = threads.find((t) => t.id === id);
    const title = window.prompt('Nombre del chat:', current?.title || '')?.trim();
    if (!title) return;
    const next = threads.map((t) => (t.id === id ? { ...t, title, updatedAt: Date.now() } : t));
    setThreads(next);
    await persistThreads(next, activeId);
  };

  const deleteThread = async (id: string) => {
    if (!user) return;
    if (!window.confirm('¿Borrar este chat y sus mensajes? No afecta tus movimientos, cuentas ni deudas.')) return;
    const remaining = threads.filter((t) => t.id !== id);
    let nextThreads = remaining;
    let nextActive = activeId;
    if (remaining.length === 0) {
      const fresh: ChatThread = { id: newThreadId(), title: 'Chat 1', createdAt: Date.now(), updatedAt: Date.now() };
      nextThreads = [fresh];
      nextActive = fresh.id;
    } else if (id === activeId) {
      nextActive = remaining[0].id;
    }
    setThreads(nextThreads); setActiveId(nextActive); setPendingAction(null);
    await persistThreads(nextThreads, nextActive);
    await deleteConversationMessages(user.uid, id).catch((error) => console.error('No pude borrar los mensajes del chat', error));
  };

  const token = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Tu sesión se venció. Cierra sesión y vuelve a entrar.');
    return currentUser.getIdToken();
  };

  // Si el chat aun tiene nombre por defecto y es el primer mensaje, lo titula con el texto.
  const maybeAutoTitle = async (firstMessage: string) => {
    if (!activeThread || messages.length > 0) return;
    const isDefault = /^chat \d+$/i.test(activeThread.title) || activeThread.title.toLowerCase() === 'nuevo chat';
    if (!isDefault) return;
    const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!title) return;
    const next = threads.map((t) => (t.id === activeThread.id ? { ...t, title, updatedAt: Date.now() } : t));
    setThreads(next);
    await persistThreads(next, activeId);
  };

  const handleSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!user || !input.trim() || loading || !activeId) return;
    const message = input.trim();
    const conversationId = activeId;
    setInput('');
    setChatError(null);
    setLoading(true);
    try {
      if (pendingAction) {
        await addChatMessage(user.uid, { text: message, sender: 'user', conversationId });
        if (isCancelText(message)) {
          await addChatMessage(user.uid, { text: 'Cancelado. No hice ningún cambio.', sender: 'bot', conversationId } as any);
          setPendingAction(null);
          return;
        }
        if (!isConfirmText(message)) {
          await addChatMessage(user.uid, { text: 'Para ejecutar esa acción responde “confirmo” o “cancelar”.', sender: 'bot', conversationId } as any);
          return;
        }
        const result = await executePendingAction(user.uid, pendingAction);
        await addChatMessage(user.uid, { text: result, sender: 'bot', conversationId } as any);
        setPendingAction(null);
        return;
      }
      await maybeAutoTitle(message);
      const pending = await runSafeChat(user.uid, message, messages, await token(), conversationId);
      if (pending) setPendingAction(pending);
    } catch (error: any) {
      setChatError(friendlyError(error));
      await addChatMessage(user.uid, { text: error?.message || 'No pude procesar el mensaje.', sender: 'bot', conversationId } as any).catch(() => undefined);
    } finally {
      setLoading(false);
    }
  };

  const containerClass = embedded
    ? 'flex h-full flex-col gap-2'
    : 'mx-auto flex h-[calc(100dvh-9rem)] w-full max-w-5xl flex-col gap-2 sm:h-[calc(100dvh-4.5rem)]';
  const messagesClass = embedded
    ? 'custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4'
    : 'custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[1.5rem] border border-slate-700/40 bg-slate-950/30 p-4';

  return (
    <div className={containerClass}>
      {/* Barra de conversaciones (varios chats, crear / cambiar / renombrar / borrar) */}
      <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-slate-700/40 bg-slate-950/40 p-2">
        <div className="custom-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto">
          {threads.map((thread) => {
            const active = thread.id === activeId;
            return (
              <div key={thread.id} className={`flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition ${active ? 'border-blue-400/40 bg-blue-500/15 text-blue-100' : 'border-slate-700/40 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60'}`}>
                <button type="button" onClick={() => switchThread(thread.id)} onDoubleClick={() => renameThread(thread.id)} className="max-w-[10rem] truncate" title={thread.title}>{thread.title}</button>
                {active && <button type="button" onClick={() => renameThread(thread.id)} className="text-slate-400 hover:text-blue-200" title="Renombrar chat"><Pencil className="h-3 w-3" /></button>}
                <button type="button" onClick={() => deleteThread(thread.id)} className="text-slate-500 hover:text-red-300" title="Borrar chat"><Trash2 className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={createThread} className="premium-button inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black"><Plus className="h-3.5 w-3.5" />Nuevo</button>
      </div>

      <div className={messagesClass} ref={scrollRef}>
        {messages.length === 0 ? (
          <EmptyState asset="chat" title="Empieza con un mensaje" description="Ejemplo: gasté 20.000 en mercado desde Nequi." />
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <article key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-3xl border px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'border-blue-400/20 bg-blue-600/20 text-blue-50' : 'border-slate-700/40 bg-slate-900/70 text-slate-100'}`}>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                    {message.sender === 'user' ? <Send className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    {message.sender === 'user' ? 'Tú' : 'Copiloto'}
                  </div>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {(message as any).transactionId && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-bold text-green-300"><CheckCircle2 className="h-3 w-3" />Movimiento guardado</p>}
                </div>
              </article>
            ))}
            {loading && <div className="flex items-center gap-2 text-sm font-bold text-blue-200"><Loader2 className="h-4 w-4 animate-spin" />Procesando con reglas contables seguras...</div>}
          </div>
        )}
      </div>

      {chatError && (
        <div className="shrink-0 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
          <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{chatError.friendly}</span></div>
        </div>
      )}

      {pendingAction && (
        <div className="shrink-0 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">
          Acción pendiente: {pendingAction.summaryText} Responde “confirmo” o “cancelar”.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex shrink-0 items-end gap-2 rounded-[1.5rem] border border-slate-700/40 bg-slate-950/60 p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Escribe valor, cuenta y acción. Ej: presté 50.000 a Juan desde Banco."
          className="lux-input min-h-12 flex-1 resize-none rounded-2xl px-4 py-3 text-sm outline-none"
          disabled={!user || loading}
        />
        <button type="submit" disabled={!input.trim() || loading} className="premium-button inline-flex h-12 w-12 items-center justify-center rounded-2xl disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

export default ChatPage;
