import type { Account, Debt, FinancialSummary, MovementKind, QueryRange, Transaction } from '../types';

export type DebtMovementKind =
  | 'loan_principal_out'
  | 'loan_principal_in'
  | 'debt_payment_in'
  | 'debt_payment_out'
  | 'debt_interest_in'
  | 'debt_interest_out';

type TransactionWithAccounting = Transaction & {
  debtId?: string;
  debtMovementKind?: DebtMovementKind | string;
};

export interface AccountAccountingSummary {
  accountId: string;
  accountName: string;
  saldoInicial: number;
  saldoFisicoCalculado: number;
  saldoRealIngresado: number;
  saldoRealConfirmado: boolean;
  diferenciaConciliacion: number;
  ingresosFisicos: number;
  ingresosReportables: number;
  ingresosHistoricosNoReportables: number;
  gastosFisicosTotales: number;
  salidasFisicasTotales: number;
  gastosReportablesOPresentes: number;
  gastosHistoricosNoReportables: number;
  transferenciasEntrantes: number;
  transferenciasSalientes: number;
  prestamosOtorgados: number;
  prestamosCobrados: number;
  prestamosRecibidos: number;
  abonosADeudasPorCobrar: number;
  abonosADeudasPorPagar: number;
  gastosPendientesCreados: number;
  gastosPendientesPagados: number;
  pagosInteresOMora: number;
  ajustesConciliacion: number;
  movimientosProtegidos: number;
  movimientosLegacy: number;
  txCount: number;
  estado: 'cuadra' | 'descuadre';
}

export interface DebtAccountingSummary {
  receivable: number;
  payable: number;
  net: number;
  openCount: number;
  deudasPorCobrarPendientes: number;
  deudasPorPagarPendientes: number;
}

export interface AccountingLedger {
  byAccount: Record<string, AccountAccountingSummary>;
  global: Omit<AccountAccountingSummary, 'accountId' | 'accountName'> & {
    accountId: 'global';
    accountName: 'Global';
    cuentasActivas: number;
    valorTotalLiquido: number;
    valorTotalConDeudasPendientes: number;
    patrimonioNeto: number;
    deudasPorCobrarPendientes: number;
    deudasPorPagarPendientes: number;
  };
}

export interface ReconciliationResult {
  saldoCalculado: number;
  saldoRealIngresado: number;
  diferencia: number;
  estado: 'cuadra' | 'descuadre';
  label: string;
}

export function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertValidInteger(value: number, original: unknown): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`Valor de dinero invalido: ${String(original)}`);
  if (value < 0) throw new Error('El dinero no puede ser negativo en este campo.');
  return value;
}

function hasValidThousandsGroups(value: string, separator: '.' | ','): boolean {
  const parts = value.split(separator);
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

export function parseCurrencyInput(input: unknown): number {
  if (typeof input === 'number') return assertValidInteger(Math.round(input), input);
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Escribe un valor de dinero.');
  if (/[-(]/.test(raw)) throw new Error('El dinero no puede ser negativo en este campo.');
  const cleaned = raw.replace(/cop/gi, '').replace(/\$/g, '').replace(/\s+/g, '').trim();
  if (!cleaned) throw new Error('Escribe un valor de dinero.');
  if (!/^[0-9.,]+$/.test(cleaned)) throw new Error(`Valor de dinero invalido: ${raw}`);
  if (/^\d+$/.test(cleaned)) return assertValidInteger(Number(cleaned), raw);
  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;
  if (dotCount > 0 && commaCount > 0) {
    const allGroups = cleaned.replace(/[.,]/g, '');
    if (/^\d+$/.test(allGroups)) return assertValidInteger(Number(allGroups), raw);
    throw new Error(`Valor de dinero ambiguo: ${raw}`);
  }
  const separator = dotCount > 0 ? '.' : ',';
  if (!hasValidThousandsGroups(cleaned, separator)) throw new Error(`Valor de dinero ambiguo: ${raw}. Usa pesos completos, por ejemplo 45.000.`);
  return assertValidInteger(Number(cleaned.replace(/[.,]/g, '')), raw);
}

export function toMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  if (typeof value === 'string' && value.trim()) {
    try { return parseCurrencyInput(value); } catch { return 0; }
  }
  return 0;
}

export function moneyEffect(tx: Pick<Transaction, 'type' | 'amount'>): number {
  const amount = toMoney(tx.amount);
  return tx.type === 'income' ? amount : -amount;
}

export function isReversedTransaction(tx: Partial<Transaction>): boolean { return Boolean(tx.isReversed || tx.reversalOf); }
export function isProtectedTransaction(tx: Partial<TransactionWithAccounting>): boolean { return Boolean(tx.transferId || tx.debtId || tx.debtMovementKind || tx.batchImportId || tx.reversalOf || tx.isReversed); }

export function inferMovementKind(tx: Partial<TransactionWithAccounting>): MovementKind {
  if (tx.movementKind) return tx.movementKind;
  const category = normalizeText(tx.category);
  const debtKind = normalizeText(tx.debtMovementKind);
  if (tx.reversalOf) return 'reconciliation_adjustment';
  if (tx.transferDirection === 'out') return 'transfer_out';
  if (tx.transferDirection === 'in') return 'transfer_in';
  if (tx.transferId || category.includes('transferencia entre cuentas')) return tx.type === 'income' ? 'transfer_in' : 'transfer_out';
  if (debtKind === 'loan_principal_out' || category.includes('prestamo entregado')) return 'loan_given';
  if (debtKind === 'loan_principal_in' || category.includes('prestamo recibido')) return 'loan_received';
  if (debtKind === 'debt_payment_in' || category.includes('pago deuda recibida')) return 'loan_payment_received';
  if (debtKind === 'debt_payment_out' || category.includes('pago deuda pagada')) return 'debt_payment_made';
  if (category.includes('gasto pendiente') || category.includes('compra fiada')) return 'payable_expense_created';
  if (category.includes('pago gasto pendiente') || category.includes('pago compra fiada')) return 'payable_expense_paid';
  if (tx.excludeFromReports) return 'historical_non_reportable';
  if (!tx.type) return 'legacy';
  return tx.type === 'income' ? 'income' : 'expense';
}

export function genericReversalBlockReason(tx: Partial<TransactionWithAccounting>): string | null {
  const kind = inferMovementKind(tx);
  if (tx.isReversed) return 'Este movimiento ya fue reversado.';
  if (tx.reversalOf) return 'Un reverso no se reversa directamente. Corrige creando el movimiento correcto.';
  if (tx.transferId || kind === 'transfer_in' || kind === 'transfer_out') return 'Movimiento de transferencia protegido: usa reverseTransfer para reversar las dos patas completas.';
  if (tx.debtId || tx.debtMovementKind || ['loan_given', 'loan_received', 'loan_payment_received', 'debt_payment_made', 'payable_expense_created', 'payable_expense_paid', 'receivable_created'].includes(kind)) return 'Movimiento de deuda protegido: usa el flujo de Deudas para abonar, corregir o anular sin descuadrar.';
  if (tx.batchImportId || kind === 'historical_non_reportable') return 'Movimiento historico/importado protegido: no se reversa como gasto o ingreso normal.';
  return null;
}

export function isTransferTransaction(tx: Partial<TransactionWithAccounting>): boolean { const kind = inferMovementKind(tx); return kind === 'transfer_in' || kind === 'transfer_out'; }
export function isDebtMovementTransaction(tx: Partial<TransactionWithAccounting>): boolean { const kind = inferMovementKind(tx); return ['loan_given','loan_received','loan_payment_received','debt_payment_made','payable_expense_created','payable_expense_paid','receivable_created'].includes(kind); }
export function affectsReport(tx: Partial<TransactionWithAccounting>): boolean { if (isReversedTransaction(tx)) return false; const kind = inferMovementKind(tx); return kind === 'income' || kind === 'expense' || kind === 'payable_expense_created'; }
export function affectsCash(tx: Partial<TransactionWithAccounting>): boolean { if (isReversedTransaction(tx)) return false; const kind = inferMovementKind(tx); return !['payable_expense_created', 'receivable_created', 'opening_balance'].includes(kind); }
export function isReportableFinancialTransaction(tx: Partial<TransactionWithAccounting>): boolean { return affectsReport(tx) && !tx.excludeFromReports; }

export function calculateReconciliation(saldoCalculado: number, saldoRealIngresado: number): ReconciliationResult {
  const calculated = toMoney(saldoCalculado);
  const real = toMoney(saldoRealIngresado);
  const diferencia = real - calculated;
  const estado = diferencia === 0 ? 'cuadra' : 'descuadre';
  return { saldoCalculado: calculated, saldoRealIngresado: real, diferencia, estado, label: estado === 'cuadra' ? 'Cuadra' : `Descuadre de ${Math.abs(diferencia).toLocaleString('es-CO')} COP` };
}

function getAccountRealBalance(account: Account): { amount: number; confirmed: boolean } {
  if (account.realBalance !== undefined && account.realBalance !== null) return { amount: toMoney(account.realBalance), confirmed: true };
  if (account.lastReconciledBalance !== undefined && account.lastReconciledBalance !== null) return { amount: toMoney(account.lastReconciledBalance), confirmed: true };
  return { amount: toMoney(account.currentBalance), confirmed: false };
}

function emptyAccountSummary(account: Account): AccountAccountingSummary {
  const saldoInicial = toMoney(account.initialBalance);
  const real = getAccountRealBalance(account);
  const reconciliation = calculateReconciliation(saldoInicial, real.amount);
  return { accountId: account.id, accountName: account.name, saldoInicial, saldoFisicoCalculado: saldoInicial, saldoRealIngresado: real.amount, saldoRealConfirmado: real.confirmed, diferenciaConciliacion: reconciliation.diferencia, ingresosFisicos: 0, ingresosReportables: 0, ingresosHistoricosNoReportables: 0, gastosFisicosTotales: 0, salidasFisicasTotales: 0, gastosReportablesOPresentes: 0, gastosHistoricosNoReportables: 0, transferenciasEntrantes: 0, transferenciasSalientes: 0, prestamosOtorgados: 0, prestamosCobrados: 0, prestamosRecibidos: 0, abonosADeudasPorCobrar: 0, abonosADeudasPorPagar: 0, gastosPendientesCreados: 0, gastosPendientesPagados: 0, pagosInteresOMora: 0, ajustesConciliacion: 0, movimientosProtegidos: 0, movimientosLegacy: 0, txCount: 0, estado: reconciliation.estado };
}

function transactionBelongsToAccount(tx: Transaction, account: Account): boolean { return tx.accountId === account.id || normalizeText(tx.accountName) === normalizeText(account.name); }

function addTransactionToSummary(summary: AccountAccountingSummary, tx: TransactionWithAccounting) {
  const amount = toMoney(tx.amount);
  const kind = inferMovementKind(tx);
  const isIncome = tx.type === 'income';
  const isExpense = tx.type === 'expense';
  summary.txCount += 1;
  if (isProtectedTransaction(tx)) summary.movimientosProtegidos += 1;
  if (kind === 'legacy') summary.movimientosLegacy += 1;
  if (affectsCash(tx)) { if (isIncome) summary.ingresosFisicos += amount; if (isExpense) { summary.gastosFisicosTotales += amount; summary.salidasFisicasTotales += amount; } }
  if (isReportableFinancialTransaction(tx) && isIncome) summary.ingresosReportables += amount;
  if (isReportableFinancialTransaction(tx) && isExpense) summary.gastosReportablesOPresentes += amount;
  if (kind === 'historical_non_reportable' && isIncome) summary.ingresosHistoricosNoReportables += amount;
  if (kind === 'historical_non_reportable' && isExpense) summary.gastosHistoricosNoReportables += amount;
  if (kind === 'transfer_in') summary.transferenciasEntrantes += amount;
  if (kind === 'transfer_out') summary.transferenciasSalientes += amount;
  if (kind === 'loan_given') summary.prestamosOtorgados += amount;
  if (kind === 'loan_received') summary.prestamosRecibidos += amount;
  if (kind === 'loan_payment_received') { summary.abonosADeudasPorCobrar += amount; summary.prestamosCobrados += amount; }
  if (kind === 'debt_payment_made') summary.abonosADeudasPorPagar += amount;
  if (kind === 'payable_expense_created') summary.gastosPendientesCreados += amount;
  if (kind === 'payable_expense_paid') summary.gastosPendientesPagados += amount;
  if (kind === 'reconciliation_adjustment') summary.ajustesConciliacion += amount;
}

export function summarizeAccount(account: Account, transactions: Transaction[]): AccountAccountingSummary {
  const summary = emptyAccountSummary(account);
  transactions.filter((tx) => transactionBelongsToAccount(tx, account)).forEach((tx) => addTransactionToSummary(summary, tx as TransactionWithAccounting));
  summary.saldoFisicoCalculado = summary.saldoInicial + summary.ingresosFisicos - summary.salidasFisicasTotales;
  const reconciliation = calculateReconciliation(summary.saldoFisicoCalculado, summary.saldoRealIngresado);
  summary.diferenciaConciliacion = reconciliation.diferencia;
  summary.estado = reconciliation.estado;
  return summary;
}

export function summarizeDebts(debts: Debt[]): DebtAccountingSummary {
  const open = debts.filter((debt) => debt.status !== 'paid' && !debt.isReversed);
  const deudasPorCobrarPendientes = open.filter((debt) => debt.direction === 'receivable').reduce((sum, debt) => sum + Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid)), 0);
  const deudasPorPagarPendientes = open.filter((debt) => debt.direction === 'payable').reduce((sum, debt) => sum + Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid)), 0);
  return { receivable: deudasPorCobrarPendientes, payable: deudasPorPagarPendientes, net: deudasPorCobrarPendientes - deudasPorPagarPendientes, openCount: open.length, deudasPorCobrarPendientes, deudasPorPagarPendientes };
}

function emptyGlobalBase(): Omit<AccountAccountingSummary, 'accountId' | 'accountName'> {
  return { saldoInicial: 0, saldoFisicoCalculado: 0, saldoRealIngresado: 0, saldoRealConfirmado: true, diferenciaConciliacion: 0, ingresosFisicos: 0, ingresosReportables: 0, ingresosHistoricosNoReportables: 0, gastosFisicosTotales: 0, salidasFisicasTotales: 0, gastosReportablesOPresentes: 0, gastosHistoricosNoReportables: 0, transferenciasEntrantes: 0, transferenciasSalientes: 0, prestamosOtorgados: 0, prestamosCobrados: 0, prestamosRecibidos: 0, abonosADeudasPorCobrar: 0, abonosADeudasPorPagar: 0, gastosPendientesCreados: 0, gastosPendientesPagados: 0, pagosInteresOMora: 0, ajustesConciliacion: 0, movimientosProtegidos: 0, movimientosLegacy: 0, txCount: 0, estado: 'cuadra' };
}

export function buildAccountingLedger(accounts: Account[], transactions: Transaction[], debts: Debt[] = []): AccountingLedger {
  const activeAccounts = accounts.filter((account) => account.active !== false);
  const byAccount = Object.fromEntries(accounts.map((account) => [account.id, summarizeAccount(account, transactions)]));
  const summaries = Object.values(byAccount);
  const debtSummary = summarizeDebts(debts);
  const base = summaries.reduce((acc, item) => {
    acc.saldoInicial += item.saldoInicial; acc.saldoFisicoCalculado += item.saldoFisicoCalculado; acc.saldoRealIngresado += item.saldoRealIngresado; acc.saldoRealConfirmado = acc.saldoRealConfirmado && item.saldoRealConfirmado; acc.ingresosFisicos += item.ingresosFisicos; acc.ingresosReportables += item.ingresosReportables; acc.ingresosHistoricosNoReportables += item.ingresosHistoricosNoReportables; acc.gastosFisicosTotales += item.gastosFisicosTotales; acc.salidasFisicasTotales += item.salidasFisicasTotales; acc.gastosReportablesOPresentes += item.gastosReportablesOPresentes; acc.gastosHistoricosNoReportables += item.gastosHistoricosNoReportables; acc.transferenciasEntrantes += item.transferenciasEntrantes; acc.transferenciasSalientes += item.transferenciasSalientes; acc.prestamosOtorgados += item.prestamosOtorgados; acc.prestamosCobrados += item.prestamosCobrados; acc.prestamosRecibidos += item.prestamosRecibidos; acc.abonosADeudasPorCobrar += item.abonosADeudasPorCobrar; acc.abonosADeudasPorPagar += item.abonosADeudasPorPagar; acc.gastosPendientesCreados += item.gastosPendientesCreados; acc.gastosPendientesPagados += item.gastosPendientesPagados; acc.pagosInteresOMora += item.pagosInteresOMora; acc.ajustesConciliacion += item.ajustesConciliacion; acc.movimientosProtegidos += item.movimientosProtegidos; acc.movimientosLegacy += item.movimientosLegacy; acc.txCount += item.txCount; return acc;
  }, emptyGlobalBase());
  const reconciliation = calculateReconciliation(base.saldoFisicoCalculado, base.saldoRealIngresado);
  const valorTotalLiquido = activeAccounts.reduce((sum, account) => sum + toMoney(getAccountRealBalance(account).amount), 0);
  const patrimonioNeto = valorTotalLiquido + debtSummary.deudasPorCobrarPendientes - debtSummary.deudasPorPagarPendientes;
  return { byAccount, global: { ...base, accountId: 'global', accountName: 'Global', diferenciaConciliacion: reconciliation.diferencia, estado: reconciliation.estado, cuentasActivas: activeAccounts.length, valorTotalLiquido, valorTotalConDeudasPendientes: patrimonioNeto, patrimonioNeto, deudasPorCobrarPendientes: debtSummary.deudasPorCobrarPendientes, deudasPorPagarPendientes: debtSummary.deudasPorPagarPendientes } };
}

export function buildFinancialSummaryForPeriod(transactions: Transaction[], start: Date, end: Date, range: QueryRange = 'custom'): FinancialSummary {
  const period = transactions.filter((tx) => isReportableFinancialTransaction(tx) && tx.date >= start && tx.date <= end);
  const totalIncome = period.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + toMoney(tx.amount), 0);
  const totalExpenses = period.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + toMoney(tx.amount), 0);
  const byCategory = period.filter((tx) => tx.type === 'expense').reduce((acc, tx) => { acc[tx.category] = (acc[tx.category] || 0) + toMoney(tx.amount); return acc; }, {} as Record<string, number>);
  return { totalIncome, totalExpenses, balance: totalIncome - totalExpenses, byCategory, range, generatedAt: new Date() };
}
