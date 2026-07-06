import ExcelJS from 'exceljs';
import type { Account, ActionLog, Debt, DeletedTransaction, Transaction } from '../types';
import { affectsCash, buildAccountingLedger, buildFinancialSummaryForPeriod, inferMovementKind, isReportableFinancialTransaction, moneyEffect, summarizeDebts, toMoney } from './accounting';

export interface MonthlyReport { totalIncome: number; totalExpenses: number; balance: number; savingsRate: number; topCategory?: [string, number]; byCategory: Record<string, number>; frequentCategories: string[]; alerts: string[]; opportunities: string[]; }
export type WorkbookParams = { transactions: Transaction[]; debts: Debt[]; accounts: Account[]; deletedTransactions?: DeletedTransaction[]; actionLogs?: ActionLog[]; fileName?: string };
const CURRENCY_FORMAT = '$ #,##0';

function currentMonth() { const now = new Date(); return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) }; }
export function getCurrentMonthTransactions(transactions: Transaction[]): Transaction[] { const { start, end } = currentMonth(); return transactions.filter((tx) => isReportableFinancialTransaction(tx) && tx.date >= start && tx.date <= end); }
export function buildMonthlyReport(transactions: Transaction[], debts: Debt[]): MonthlyReport {
  const { start, end } = currentMonth();
  const summary = buildFinancialSummaryForPeriod(transactions, start, end, 'this_month');
  const sorted = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
  const debtSummary = summarizeDebts(debts);
  const savingsRate = summary.balance / summary.totalIncome;
  const rate = summary.totalIncome > 0 ? savingsRate * 100 : 0;
  const alerts: string[] = [];
  if (summary.totalIncome === 0 && summary.totalExpenses > 0) alerts.push('Hay gastos registrados sin ingresos este mes. Revisa si falta registrar entradas.');
  if (summary.totalExpenses > summary.totalIncome && summary.totalIncome > 0) alerts.push('Los gastos superan los ingresos del mes. Prioriza recortar gastos variables.');
  if (debtSummary.payable > debtSummary.receivable && debtSummary.payable > 0) alerts.push('Tus deudas por pagar superan lo que te deben. Conviene hacer plan de pagos.');
  if (sorted[0] && summary.totalExpenses > 0 && sorted[0][1] / summary.totalExpenses > 0.45) alerts.push(`La categoria ${sorted[0][0]} concentra mas del 45% del gasto mensual.`);
  const opportunities: string[] = [];
  if (rate < 10 && summary.totalIncome > 0) opportunities.push('Meta sugerida: separar minimo 10% de cada ingreso antes de seguir gastando.');
  if (debtSummary.receivable > 0) opportunities.push('Haz seguimiento a la plata prestada: cobrar a tiempo mejora tu flujo de caja.');
  if (sorted.length > 0) opportunities.push(`Primera fuga a revisar: ${sorted[0][0]} por ser la categoria mas alta.`);
  if (opportunities.length === 0) opportunities.push('Manten registro diario para que la IA pueda detectar patrones con mas precision.');
  return { totalIncome: summary.totalIncome, totalExpenses: summary.totalExpenses, balance: summary.balance, savingsRate: rate, topCategory: sorted[0], byCategory: summary.byCategory, frequentCategories: sorted.slice(0, 5).map(([name]) => name), alerts, opportunities };
}

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export interface MonthlyTrendPoint { label: string; income: number; expenses: number; balance: number; }

// Ingresos/gastos/balance de los ultimos N meses (para la grafica de tendencia).
export function buildMonthlyTrend(transactions: Transaction[], months = 6): MonthlyTrendPoint[] {
  const now = new Date();
  const points: MonthlyTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    const s = buildFinancialSummaryForPeriod(transactions, start, end, 'custom');
    points.push({ label: MONTHS_ES[ref.getMonth()], income: s.totalIncome, expenses: s.totalExpenses, balance: s.balance });
  }
  return points;
}

// Exporta a Excel EXACTAMENTE los movimientos que se pasen (p.ej. los filtrados
// en la pantalla Movimientos). Reusa ExcelJS ya incluido en el bundle.
export async function exportTransactionsTable(transactions: Transaction[], fileName = 'movimientos.xlsx') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ingresos y Egresos Hogar';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Naturaleza', key: 'kind', width: 22 },
    { header: 'Descripcion', key: 'description', width: 42 },
    { header: 'Categoria', key: 'category', width: 20 },
    { header: 'Cuenta', key: 'account', width: 22 },
    { header: 'Valor', key: 'amount', width: 16 },
  ];
  transactions.forEach((tx) => sheet.addRow({
    date: dt(tx.date),
    type: tx.type === 'income' ? 'Ingreso' : 'Gasto',
    kind: inferMovementKind(tx),
    description: tx.description,
    category: tx.category,
    account: tx.accountName,
    amount: (tx.type === 'income' ? 1 : -1) * toMoney(tx.amount),
  }));
  style(sheet, [7]);
  const buffer = await workbook.xlsx.writeBuffer();
  if (typeof window === 'undefined' || typeof document === 'undefined') return buffer;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  window.URL.revokeObjectURL(url);
  return buffer;
}

function m(value: unknown): number { return toMoney(value); }
function dt(value?: Date | null): string { return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toLocaleString('es-CO'): ''; }
function json(value: unknown): string { if (value === undefined || value === null || value === '') return ''; try { return JSON.stringify(value).slice(0, 32000); } catch { return String(value).slice(0, 32000); } }
function style(sheet: ExcelJS.Worksheet, moneyColumns: number[] = []) { const header = sheet.getRow(1); header.font = { bold: true, color: { argb: 'FFFFFFFF' } }; header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }; }); sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) moneyColumns.forEach((index) => { row.getCell(index).numFmt = CURRENCY_FORMAT; }); }); }

export function buildFinanceWorkbook(params: WorkbookParams): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ledger = buildAccountingLedger(params.accounts, params.transactions, params.debts);
  const debtSummary = summarizeDebts(params.debts);
  workbook.creator = 'Ingresos y Egresos Hogar';
  workbook.created = new Date();

  const cover = workbook.addWorksheet('Portada');
  cover.columns = [{ header: 'Indicador', key: 'indicator', width: 38 }, { header: 'Valor', key: 'value', width: 28 }, { header: 'Note', key: 'note', width: 72 }];
  [
    { indicator: 'Saldo calculado global', value: ledger.global.saldoFisicoCalculado, note: 'Fuente: buildAccountingLedger' },
    { indicator: 'Saldo real global', value: ledger.global.saldoRealIngresado, note: ledger.global.saldoRealConfirmado ? 'Confirmado' : 'Pendiente' },
    { indicator: 'Diferencia conciliacion', value: ledger.global.diferenciaConciliacion, note: ledger.global.estado },
    { indicator: 'Ingresos reportables', value: ledger.global.ingresosReportables, note: 'No incluye transferencias ni deudas' },
    { indicator: 'Gastos reportables', value: ledger.global.gastosReportablesOPresentes, note: 'No incluye transferencias, deudas ni historicos' },
    { indicator: 'Historicos/no reportables', value: ledger.global.gastosHistoricosNoReportables + ledger.global.ingresosHistoricosNoReportables, note: 'Separados de reportables' },
    { indicator: 'Te deben pendiente', value: debtSummary.receivable, note: 'Deudas abiertas por cobrar' },
    { indicator: 'Tu debes pendiente', value: debtSummary.payable, note: 'Deudas abiertas por pagar' },
    { indicator: 'Patrimonio neto', value: ledger.global.patrimonioNeto, note: 'Liquido + te deben - tu debes' },
  ].forEach((r) => cover.addRow(r));
  style(cover, [2]);

  const accounts = workbook.addWorksheet('Cuentas');
  accounts.columns = [{ header: 'Cuenta', key: 'account', width: 26 }, { header: 'Saldo inicial', key: 'initial', width: 16 }, { header: 'Saldo calculado', key: 'calculated', width: 18 }, { header: 'Saldo real', key: 'real', width: 16 }, { header: 'Confirmado', key: 'confirmed', width: 12 }, { header: 'Diferencia', key: 'difference', width: 16 }, { header: 'Estado', key: 'status', width: 14 }, { header: 'Ingresos reportables', key: 'income', width: 20 }, { header: 'Gastos reportables', key: 'expense', width: 20 }, { header: 'Historicos', key: 'historical', width: 16 }, { header: 'Transfer in', key: 'transferIn', width: 16 }, { header: 'Transfer out', key: 'transferOut', width: 16 }];
  params.accounts.forEach((account) => { const item = ledger.byAccount[account.id]; accounts.addRow({ account: account.name, initial: item.saldoInicial, calculated: item.saldoFisicoCalculado, real: item.saldoRealIngresado, confirmed: item.saldoRealConfirmado ? 'Si' : 'No', difference: item.diferenciaConciliacion, status: item.saldoRealConfirmado ? item.estado : 'Pendiente', income: item.ingresosReportables, expense: item.gastosReportablesOPresentes, historical: item.gastosHistoricosNoReportables + item.ingresosHistoricosNoReportables, transferIn: item.transferenciasEntrantes, transferOut: item.transferenciasSalientes }); });
  style(accounts, [2, 3, 4, 6, 8, 9, 10, 11, 12]);

  const txSheet = workbook.addWorksheet('Movimientos');
  txSheet.columns = [{ header: 'ID', key: 'id', width: 28 }, { header: 'Fecha', key: 'date', width: 20 }, { header: 'Tipo', key: 'type', width: 12 }, { header: 'Naturaleza', key: 'kind', width: 24 }, { header: 'Descripcion', key: 'description', width: 42 }, { header: 'Categoria', key: 'category', width: 24 }, { header: 'Cuenta', key: 'account', width: 24 }, { header: 'Valor', key: 'amount', width: 16 }, { header: 'Efecto caja', key: 'effect', width: 16 }, { header: 'Reportable', key: 'reportable', width: 14 }, { header: 'Reversado', key: 'reversed', width: 12 }, { header: 'Reverso de', key: 'reversalOf', width: 28 }, { header: 'Transfer ID', key: 'transferId', width: 28 }, { header: 'Debt ID', key: 'debtId', width: 28 }];
  params.transactions.forEach((tx) => txSheet.addRow({ id: tx.id, date: dt(tx.date), type: tx.type, kind: inferMovementKind(tx), description: tx.description, category: tx.category, account: tx.accountName, amount: m(tx.amount), effect: affectsCash(tx) ? moneyEffect(tx) : 0, reportable: isReportableFinancialTransaction(tx) ? 'Si' : 'No', reversed: tx.isReversed ? 'Si' : 'No', reversalOf: tx.reversalOf || '', transferId: tx.transferId || '', debtId: tx.debtId || '' }));
  style(txSheet, [8, 9]);

  const debtSheet = workbook.addWorksheet('Deudas');
  debtSheet.columns = [{ header: 'ID', key: 'id', width: 28 }, { header: 'Tipo', key: 'direction', width: 16 }, { header: 'Persona', key: 'person', width: 24 }, { header: 'Valor', key: 'amount', width: 16 }, { header: 'Pagado', key: 'paid', width: 16 }, { header: 'Pendiente', key: 'remaining', width: 16 }, { header: 'Estado', key: 'status', width: 14 }, { header: 'Anulada', key: 'voided', width: 12 }, { header: 'Cuenta', key: 'account', width: 24 }];
  params.debts.forEach((debt) => debtSheet.addRow({ id: debt.id, direction: debt.direction === 'receivable' ? 'Me deben' : 'Yo debo', person: debt.personName, amount: m(debt.amountOriginal), paid: m(debt.amountPaid), remaining: Math.max(0, m(debt.amountOriginal) - m(debt.amountPaid)), status: debt.status, voided: debt.isReversed ? 'Si' : 'No', account: debt.linkedAccountName || '' }));
  style(debtSheet, [4, 5, 6]);

  const logSheet = workbook.addWorksheet('Auditoria');
  logSheet.columns = [{ header: 'Fecha', key: 'date', width: 22 }, { header: 'Accion', key: 'action', width: 28 }, { header: 'Entidad', key: 'entity', width: 18 }, { header: 'Descripcion', key: 'description', width: 60 }, { header: 'Antes', key: 'before', width: 60 }, { header: 'Despues', key: 'after', width: 60 }];
  (params.actionLogs || []).forEach((log) => logSheet.addRow({ date: dt(log.createdAt), action: log.action, entity: log.entityType, description: log.description, before: json(log.before), after: json(log.after) }));
  style(logSheet);

  const deletedSheet = workbook.addWorksheet('Papelera');
  deletedSheet.columns = [{ header: 'ID', key: 'id', width: 28 }, { header: 'Original', key: 'original', width: 28 }, { header: 'Fecha', key: 'date', width: 22 }, { header: 'Descripcion', key: 'description', width: 42 }, { header: 'Valor', key: 'amount', width: 16 }];
  (params.deletedTransactions || []).forEach((tx) => deletedSheet.addRow({ id: tx.deletedId, original: tx.originalId, date: dt(tx.deletedAt), description: tx.description, amount: tx.amount }));
  style(deletedSheet, [5]);
  return workbook;
}

export async function exportFinanceWorkbook(params: WorkbookParams) {
  const workbook = buildFinanceWorkbook(params);
  const buffer = await workbook.xlsx.writeBuffer();
  if (typeof window === 'undefined' || typeof document === 'undefined') return buffer;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.fileName || `reporte-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  window.URL.revokeObjectURL(url);
  return buffer;
}
