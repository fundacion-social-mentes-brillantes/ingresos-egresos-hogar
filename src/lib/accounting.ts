import type { Account, Debt, FinancialSummary, QueryRange, Transaction } from '../types';

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
  pagosInteresOMora: number;
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

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertValidInteger(value: number, original: unknown): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Valor de dinero invalido: ${String(original)}`);
  }
  if (value < 0) {
    throw new Error('El dinero no puede ser negativo en este campo.');
  }
  return value;
}

function hasValidThousandsGroups(value: string, separator: '.' | ','): boolean {
  const parts = value.split(separator);
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

/**
 * Parses Colombian peso inputs as integer COP values.
 * Valid: "45000", "45.000", "$45.000", "599.000", "2.912.319", "2,912,319".
 * Invalid ambiguous decimals are rejected instead of guessed.
 */
export function parseCurrencyInput(input: unknown): number {
  if (typeof input === 'number') {
    return assertValidInteger(Math.round(input), input);
  }

  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Escribe un valor de dinero.');
  if (/[-(]/.test(raw)) throw new Error('El dinero no puede ser negativo en este campo.');

  const cleaned = raw
    .replace(/cop/gi, '')
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!cleaned) throw new Error('Escribe un valor de dinero.');
  if (!/^[0-9.,]+$/.test(cleaned)) {
    throw new Error(`Valor de dinero invalido: ${raw}`);
  }

  if (/^\d+$/.test(cleaned)) {
    return assertValidInteger(Number(cleaned), raw);
  }

  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;

  if (dotCount > 0 && commaCount > 0) {
    const allGroups = cleaned.replace(/[.,]/g, '');
    const dotGroupsValid = cleaned.includes('.') ? cleaned.split('.').every((part, index) => (index === 0 ? /^\d{1,3}$/.test(part.replace(/,/g, '')) : /^\d{3}(,\d{3})*$/.test(part))) : true;
    const commaGroupsValid = cleaned.includes(',') ? hasValidThousandsGroups(cleaned, ',') : true;
    if (/^\d+$/.test(allGroups) && (commaGroupsValid || dotGroupsValid)) {
      return assertValidInteger(Number(allGroups), raw);
    }
    throw new Error(`Valor de dinero ambiguo: ${raw}`);
  }

  const separator = dotCount > 0 ? '.' : ',';
  if (!hasValidThousandsGroups(cleaned, separator)) {
    throw new Error(`Valor de dinero ambiguo: ${raw}. Usa pesos completos, por ejemplo 45.000.`);
  }

  return assertValidInteger(Number(cleaned.replace(/[.,]/g, '')), raw);
}

export function toMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseCurrencyInput(value);
    } catch {
      return 0;
    }
  }
  return 0;
}

export function moneyEffect(tx: Pick<Transaction, 'type' | 'amount'>): number {
  const amount = toMoney(tx.amount);
  return tx.type === 'income' ? amount : -amount;
}

export function isTransferTransaction(tx: Partial<TransactionWithAccounting>): boolean {
  return Boolean(
    tx.transferId ||
    tx.transferDirection ||
    normalizeText(tx.category).includes('transferencia entre cuentas')
  );
}

export function isDebtMovementTransaction(tx: Partial<TransactionWithAccounting>): boolean {
  const kind = normalizeText(tx.debtMovementKind);
  const category = normalizeText(tx.category);
  return Boolean(
    tx.debtId ||
    kind ||
    category.includes('prestamo entregado') ||
    category.includes('prestamo recibido') ||
    category.includes('pago deuda recibida') ||
    category.includes('pago deuda pagada')
  );
}

export function isReportableFinancialTransaction(tx: Partial<TransactionWithAccounting>): boolean {
  return !tx.excludeFromReports && !isTransferTransaction(tx) && !isDebtMovementTransaction(tx);
}

export function calculateReconciliation(saldoCalculado: number, saldoRealIngresado: number): ReconciliationResult {
  const calculated = toMoney(saldoCalculado);
  const real = toMoney(saldoRealIngresado);
  const diferencia = real - calculated;
  const estado = Math.abs(diferencia) <= 1 ? 'cuadra' : 'descuadre';
  return {
    saldoCalculado: calculated,
    saldoRealIngresado: real,
    diferencia,
    estado,
    label: estado === 'cuadra' ? 'Cuadra' : `Descuadre de ${Math.abs(diferencia).toLocaleString('es-CO')} COP`,
  };
}

function emptyAccountSummary(account: Account): AccountAccountingSummary {
  const saldoInicial = toMoney(account.initialBalance);
  const saldoRealIngresado = toMoney(account.currentBalance);
  const reconciliation = calculateReconciliation(saldoInicial, saldoRealIngresado);
  return {
    accountId: account.id,
    accountName: account.name,
    saldoInicial,
    saldoFisicoCalculado: saldoInicial,
    saldoRealIngresado,
    diferenciaConciliacion: reconciliation.diferencia,
    ingresosFisicos: 0,
    ingresosReportables: 0,
    ingresosHistoricosNoReportables: 0,
    gastosFisicosTotales: 0,
    salidasFisicasTotales: 0,
    gastosReportablesOPresentes: 0,
    gastosHistoricosNoReportables: 0,
    transferenciasEntrantes: 0,
    transferenciasSalientes: 0,
    prestamosOtorgados: 0,
    prestamosCobrados: 0,
    prestamosRecibidos: 0,
    abonosADeudasPorCobrar: 0,
    abonosADeudasPorPagar: 0,
    pagosInteresOMora: 0,
    txCount: 0,
    estado: reconciliation.estado,
  };
}

function transactionBelongsToAccount(tx: Transaction, account: Account): boolean {
  return tx.accountId === account.id || normalizeText(tx.accountName) === normalizeText(account.name);
}

function addTransactionToSummary(summary: AccountAccountingSummary, tx: TransactionWithAccounting) {
  const amount = toMoney(tx.amount);
  const isIncome = tx.type === 'income';
  const isExpense = tx.type === 'expense';
  const isTransfer = isTransferTransaction(tx);
  const isDebt = isDebtMovementTransaction(tx);
  const isReportable = isReportableFinancialTransaction(tx);
  const isHistorical = Boolean(tx.excludeFromReports) && !isTransfer && !isDebt;
  const kind = String(tx.debtMovementKind || '');

  summary.txCount += 1;
  if (isIncome) summary.ingresosFisicos += amount;
  if (isExpense) {
    summary.gastosFisicosTotales += amount;
    summary.salidasFisicasTotales += amount;
  }

  if (isReportable && isIncome) summary.ingresosReportables += amount;
  if (isReportable && isExpense) summary.gastosReportablesOPresentes += amount;

  if (isHistorical && isIncome) summary.ingresosHistoricosNoReportables += amount;
  if (isHistorical && isExpense) summary.gastosHistoricosNoReportables += amount;

  if (isTransfer && tx.transferDirection === 'in' && isIncome) summary.transferenciasEntrantes += amount;
  if (isTransfer && tx.transferDirection === 'out' && isExpense) summary.transferenciasSalientes += amount;

  if (kind === 'loan_principal_out') summary.prestamosOtorgados += amount;
  if (kind === 'loan_principal_in') summary.prestamosRecibidos += amount;
  if (kind === 'debt_payment_in') summary.abonosADeudasPorCobrar += amount;
  if (kind === 'debt_payment_out') summary.abonosADeudasPorPagar += amount;
  if (kind === 'debt_interest_in' || kind === 'debt_interest_out') summary.pagosInteresOMora += amount;
}

export function summarizeAccount(account: Account, transactions: Transaction[]): AccountAccountingSummary {
  const summary = emptyAccountSummary(account);
  transactions
    .filter((tx) => transactionBelongsToAccount(tx, account))
    .forEach((tx) => addTransactionToSummary(summary, tx as TransactionWithAccounting));

  summary.saldoFisicoCalculado = summary.saldoInicial + summary.ingresosFisicos - summary.salidasFisicasTotales;
  const reconciliation = calculateReconciliation(summary.saldoFisicoCalculado, summary.saldoRealIngresado);
  summary.diferenciaConciliacion = reconciliation.diferencia;
  summary.estado = reconciliation.estado;
  return summary;
}

export function summarizeDebts(debts: Debt[]): DebtAccountingSummary {
  const open = debts.filter((debt) => debt.status !== 'paid');
  const deudasPorCobrarPendientes = open
    .filter((debt) => debt.direction === 'receivable')
    .reduce((sum, debt) => sum + Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid)), 0);
  const deudasPorPagarPendientes = open
    .filter((debt) => debt.direction === 'payable')
    .reduce((sum, debt) => sum + Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid)), 0);

  return {
    receivable: deudasPorCobrarPendientes,
    payable: deudasPorPagarPendientes,
    net: deudasPorCobrarPendientes - deudasPorPagarPendientes,
    openCount: open.length,
    deudasPorCobrarPendientes,
    deudasPorPagarPendientes,
  };
}

export function buildAccountingLedger(accounts: Account[], transactions: Transaction[], debts: Debt[] = []): AccountingLedger {
  const activeAccounts = accounts.filter((account) => account.active !== false);
  const byAccount = Object.fromEntries(accounts.map((account) => [account.id, summarizeAccount(account, transactions)]));
  const summaries = Object.values(byAccount);
  const debtSummary = summarizeDebts(debts);

  const base = summaries.reduce((acc, item) => {
    acc.saldoInicial += item.saldoInicial;
    acc.saldoFisicoCalculado += item.saldoFisicoCalculado;
    acc.saldoRealIngresado += item.saldoRealIngresado;
    acc.ingresosFisicos += item.ingresosFisicos;
    acc.ingresosReportables += item.ingresosReportables;
    acc.ingresosHistoricosNoReportables += item.ingresosHistoricosNoReportables;
    acc.gastosFisicosTotales += item.gastosFisicosTotales;
    acc.salidasFisicasTotales += item.salidasFisicasTotales;
    acc.gastosReportablesOPresentes += item.gastosReportablesOPresentes;
    acc.gastosHistoricosNoReportables += item.gastosHistoricosNoReportables;
    acc.transferenciasEntrantes += item.transferenciasEntrantes;
    acc.transferenciasSalientes += item.transferenciasSalientes;
    acc.prestamosOtorgados += item.prestamosOtorgados;
    acc.prestamosCobrados += item.prestamosCobrados;
    acc.prestamosRecibidos += item.prestamosRecibidos;
    acc.abonosADeudasPorCobrar += item.abonosADeudasPorCobrar;
    acc.abonosADeudasPorPagar += item.abonosADeudasPorPagar;
    acc.pagosInteresOMora += item.pagosInteresOMora;
    acc.txCount += item.txCount;
    return acc;
  }, {
    saldoInicial: 0,
    saldoFisicoCalculado: 0,
    saldoRealIngresado: 0,
    diferenciaConciliacion: 0,
    ingresosFisicos: 0,
    ingresosReportables: 0,
    ingresosHistoricosNoReportables: 0,
    gastosFisicosTotales: 0,
    salidasFisicasTotales: 0,
    gastosReportablesOPresentes: 0,
    gastosHistoricosNoReportables: 0,
    transferenciasEntrantes: 0,
    transferenciasSalientes: 0,
    prestamosOtorgados: 0,
    prestamosCobrados: 0,
    prestamosRecibidos: 0,
    abonosADeudasPorCobrar: 0,
    abonosADeudasPorPagar: 0,
    pagosInteresOMora: 0,
    txCount: 0,
    estado: 'cuadra' as const,
  });

  const reconciliation = calculateReconciliation(base.saldoFisicoCalculado, base.saldoRealIngresado);
  const valorTotalLiquido = activeAccounts.reduce((sum, account) => sum + toMoney(account.currentBalance), 0);
  const patrimonioNeto = valorTotalLiquido + debtSummary.deudasPorCobrarPendientes - debtSummary.deudasPorPagarPendientes;

  return {
    byAccount,
    global: {
      ...base,
      accountId: 'global',
      accountName: 'Global',
      diferenciaConciliacion: reconciliation.diferencia,
      estado: reconciliation.estado,
      cuentasActivas: activeAccounts.length,
      valorTotalLiquido,
      valorTotalConDeudasPendientes: patrimonioNeto,
      patrimonioNeto,
      deudasPorCobrarPendientes: debtSummary.deudasPorCobrarPendientes,
      deudasPorPagarPendientes: debtSummary.deudasPorPagarPendientes,
    },
  };
}

export function buildFinancialSummaryForPeriod(
  transactions: Transaction[],
  start: Date,
  end: Date,
  range: QueryRange = 'custom'
): FinancialSummary {
  const period = transactions.filter((tx) => isReportableFinancialTransaction(tx) && tx.date >= start && tx.date <= end);
  const totalIncome = period.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + toMoney(tx.amount), 0);
  const totalExpenses = period.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + toMoney(tx.amount), 0);
  const byCategory = period
    .filter((tx) => tx.type === 'expense')
    .reduce((acc, tx) => {
      acc[tx.category] = (acc[tx.category] || 0) + toMoney(tx.amount);
      return acc;
    }, {} as Record<string, number>);

  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    byCategory,
    range,
    generatedAt: new Date(),
  };
}
