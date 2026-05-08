import ExcelJS from 'exceljs';
import type { Account, Debt, Transaction } from '../types';

export interface MonthlyReport {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  savingsRate: number;
  topCategory?: [string, number];
  byCategory: Record<string, number>;
  frequentCategories: string[];
  alerts: string[];
  opportunities: string[];
}

export function getCurrentMonthTransactions(transactions: Transaction[]): Transaction[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return transactions.filter((tx) => tx.date >= start && tx.date <= end);
}

export function buildMonthlyReport(transactions: Transaction[], debts: Debt[]): MonthlyReport {
  const monthly = getCurrentMonthTransactions(transactions);
  const totalIncome = monthly.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses = monthly.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const byCategory = monthly.filter((tx) => tx.type === 'expense').reduce<Record<string, number>>((acc, tx) => {
    acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
    return acc;
  }, {});
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const receivable = debts.filter((d) => d.status !== 'paid' && d.direction === 'receivable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);
  const payable = debts.filter((d) => d.status !== 'paid' && d.direction === 'payable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0;

  const alerts: string[] = [];
  if (totalIncome === 0 && totalExpenses > 0) alerts.push('Hay gastos registrados sin ingresos este mes. Revisa si falta registrar entradas.');
  if (totalExpenses > totalIncome && totalIncome > 0) alerts.push('Los gastos superan los ingresos del mes. Prioriza recortar gastos variables.');
  if (payable > receivable && payable > 0) alerts.push('Tus deudas por pagar superan lo que te deben. Conviene hacer plan de pagos.');
  if (sorted[0] && totalExpenses > 0 && sorted[0][1] / totalExpenses > 0.45) alerts.push(`La categoría ${sorted[0][0]} concentra más del 45% del gasto mensual.`);

  const opportunities: string[] = [];
  if (savingsRate < 10 && totalIncome > 0) opportunities.push('Meta sugerida: separar mínimo 10% de cada ingreso antes de seguir gastando.');
  if (receivable > 0) opportunities.push('Haz seguimiento a la plata prestada: cobrar a tiempo mejora tu flujo de caja.');
  if (sorted.length > 0) opportunities.push(`Primera fuga a revisar: ${sorted[0][0]} por ser la categoría más alta.`);
  if (opportunities.length === 0) opportunities.push('Mantén registro diario para que la IA pueda detectar patrones con más precisión.');

  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    savingsRate,
    topCategory: sorted[0],
    byCategory,
    frequentCategories: sorted.slice(0, 5).map(([name]) => name),
    alerts,
    opportunities,
  };
}

function addCurrencyCell(row: ExcelJS.Row, index: number) {
  row.getCell(index).numFmt = '$ #,##0';
}

export async function exportFinanceWorkbook(params: {
  transactions: Transaction[];
  debts: Debt[];
  accounts: Account[];
  fileName?: string;
}) {
  const { transactions, debts, accounts, fileName = 'respaldo-financiero-profesional.xlsx' } = params;
  const report = buildMonthlyReport(transactions, debts);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ingresos y Egresos Hogar';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Resumen mensual');
  summary.columns = [{ header: 'Indicador', key: 'indicator', width: 34 }, { header: 'Valor', key: 'value', width: 24 }];
  summary.addRows([
    { indicator: 'Ingresos del mes', value: report.totalIncome },
    { indicator: 'Gastos del mes', value: report.totalExpenses },
    { indicator: 'Balance del mes', value: report.balance },
    { indicator: 'Tasa de ahorro estimada (%)', value: Number(report.savingsRate.toFixed(2)) },
    { indicator: 'Categoría principal', value: report.topCategory ? `${report.topCategory[0]} (${report.topCategory[1]})` : 'Sin datos' },
  ]);
  summary.eachRow((row, rowNumber) => { if (rowNumber === 1) row.font = { bold: true }; if (rowNumber >= 2 && rowNumber <= 4) addCurrencyCell(row, 2); });

  const txSheet = workbook.addWorksheet('Movimientos');
  txSheet.columns = [
    { header: 'Fecha', key: 'date', width: 16 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Categoría', key: 'category', width: 18 },
    { header: 'Cuenta', key: 'account', width: 18 },
    { header: 'Valor', key: 'amount', width: 16 },
    { header: 'Origen', key: 'source', width: 12 },
  ];
  transactions.forEach((tx) => txSheet.addRow({ date: tx.date.toLocaleDateString('es-CO'), type: tx.type === 'income' ? 'Ingreso' : 'Gasto', description: tx.description, category: tx.category, account: tx.accountName, amount: tx.amount, source: tx.source }));
  txSheet.eachRow((row, rowNumber) => { if (rowNumber === 1) row.font = { bold: true }; if (rowNumber > 1) addCurrencyCell(row, 6); });

  const debtSheet = workbook.addWorksheet('Deudas');
  debtSheet.columns = [
    { header: 'Tipo', key: 'direction', width: 16 },
    { header: 'Persona', key: 'person', width: 24 },
    { header: 'Descripción', key: 'description', width: 35 },
    { header: 'Valor inicial', key: 'original', width: 16 },
    { header: 'Abonado', key: 'paid', width: 16 },
    { header: 'Pendiente', key: 'remaining', width: 16 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Fecha pactada', key: 'due', width: 16 },
    { header: 'Notas', key: 'notes', width: 40 },
  ];
  debts.forEach((debt) => debtSheet.addRow({ direction: debt.direction === 'receivable' ? 'Me deben' : 'Yo debo', person: debt.personName, description: debt.description, original: debt.amountOriginal, paid: debt.amountPaid, remaining: Math.max(0, debt.amountOriginal - debt.amountPaid), status: debt.status, due: debt.dueDate ? debt.dueDate.toLocaleDateString('es-CO') : '', notes: debt.notes || '' }));
  debtSheet.eachRow((row, rowNumber) => { if (rowNumber === 1) row.font = { bold: true }; if (rowNumber > 1) [4,5,6].forEach((i) => addCurrencyCell(row, i)); });

  const accountsSheet = workbook.addWorksheet('Cuentas');
  accountsSheet.columns = [{ header: 'Cuenta', key: 'name', width: 24 }, { header: 'Tipo', key: 'type', width: 16 }, { header: 'Saldo actual', key: 'balance', width: 16 }];
  accounts.forEach((account) => accountsSheet.addRow({ name: account.name, type: account.type, balance: account.currentBalance }));
  accountsSheet.eachRow((row, rowNumber) => { if (rowNumber === 1) row.font = { bold: true }; if (rowNumber > 1) addCurrencyCell(row, 3); });

  const advice = workbook.addWorksheet('Alertas y oportunidades');
  advice.columns = [{ header: 'Tipo', key: 'type', width: 18 }, { header: 'Mensaje', key: 'message', width: 90 }];
  report.alerts.forEach((message) => advice.addRow({ type: 'Alerta', message }));
  report.opportunities.forEach((message) => advice.addRow({ type: 'Oportunidad', message }));
  advice.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
