import ExcelJS from 'exceljs';
import type { Account, ActionLog, Debt, DeletedTransaction, Transaction } from '../types';

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

const CURRENCY_FORMAT = '$ #,##0';
const DATE_FORMAT = 'dd/mm/yyyy';
const DATETIME_FORMAT = 'dd/mm/yyyy hh:mm';

function isReportable(tx: Transaction): boolean {
  return !tx.excludeFromReports;
}

export function getCurrentMonthTransactions(transactions: Transaction[]): Transaction[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return transactions.filter((tx) => isReportable(tx) && tx.date >= start && tx.date <= end);
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
  if (sorted[0] && totalExpenses > 0 && sorted[0][1] / totalExpenses > 0.45) alerts.push(`La categoria ${sorted[0][0]} concentra mas del 45% del gasto mensual.`);

  const opportunities: string[] = [];
  if (savingsRate < 10 && totalIncome > 0) opportunities.push('Meta sugerida: separar minimo 10% de cada ingreso antes de seguir gastando.');
  if (receivable > 0) opportunities.push('Haz seguimiento a la plata prestada: cobrar a tiempo mejora tu flujo de caja.');
  if (sorted.length > 0) opportunities.push(`Primera fuga a revisar: ${sorted[0][0]} por ser la categoria mas alta.`);
  if (opportunities.length === 0) opportunities.push('Manten registro diario para que la IA pueda detectar patrones con mas precision.');

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

function formatDate(value?: Date | null): string {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toLocaleDateString('es-CO') : '';
}

function formatDateTime(value?: Date | null): string {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toLocaleString('es-CO') : '';
}

function jsonPreview(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  try {
    return JSON.stringify(value).slice(0, 32000);
  } catch {
    return String(value).slice(0, 32000);
  }
}

function moneyEffect(tx: Transaction): number {
  return tx.type === 'income' ? tx.amount : -tx.amount;
}

function money(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function addCurrencyCell(row: ExcelJS.Row, index: number) {
  row.getCell(index).numFmt = CURRENCY_FORMAT;
}

function styleTitle(row: ExcelJS.Row) {
  row.height = 28;
  row.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDB2777' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFF9A8D4' } } };
  });
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
  });
}

function styleSheet(sheet: ExcelJS.Worksheet, currencyColumns: number[] = [], dateColumns: number[] = []) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.properties.defaultRowHeight = 19;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  styleHeader(sheet.getRow(1));
  const lastColumn = sheet.columnCount || sheet.columns.length;
  if (lastColumn > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastColumn } };
  }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
    });
    currencyColumns.forEach((index) => addCurrencyCell(row, index));
    dateColumns.forEach((index) => {
      row.getCell(index).numFmt = DATE_FORMAT;
    });
  });
}

function addCoverSheet(workbook: ExcelJS.Workbook, params: {
  transactions: Transaction[];
  debts: Debt[];
  accounts: Account[];
  deletedTransactions: DeletedTransaction[];
  actionLogs: ActionLog[];
  generatedAt: Date;
}) {
  const sheet = workbook.addWorksheet('Portada');
  sheet.columns = [{ width: 34 }, { width: 26 }, { width: 26 }, { width: 26 }];
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'Respaldo completo - Ingresos y Egresos Hogar';
  styleTitle(sheet.getRow(1));

  const activeAccounts = params.accounts.filter((account) => account.active !== false);
  const availableBalance = activeAccounts.reduce((sum, account) => sum + Number(account.currentBalance || 0), 0);
  const receivable = params.debts.filter((d) => d.status !== 'paid' && d.direction === 'receivable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);
  const payable = params.debts.filter((d) => d.status !== 'paid' && d.direction === 'payable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);

  sheet.addRow([]);
  sheet.addRows([
    ['Generado', formatDateTime(params.generatedAt)],
    ['Movimientos exportados', params.transactions.length],
    ['Cuentas exportadas', params.accounts.length],
    ['Deudas exportadas', params.debts.length],
    ['Movimientos eliminados exportados', params.deletedTransactions.length],
    ['Acciones de auditoria exportadas', params.actionLogs.length],
    ['Saldo disponible en cuentas activas', availableBalance],
    ['Te deben pendiente', receivable],
    ['Tu debes pendiente', payable],
    ['Patrimonio operativo estimado', availableBalance + receivable - payable],
  ]);
  [9, 10, 11, 12].forEach((rowNumber) => addCurrencyCell(sheet.getRow(rowNumber), 2));
  sheet.getColumn(1).font = { bold: true };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7F3' } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
  });

  sheet.addRow([]);
  sheet.addRow(['Contenido del archivo']);
  sheet.getRow(15).font = { bold: true, size: 13, color: { argb: 'FFBE185D' } };
  sheet.addRows([
    ['Resumen ejecutivo', 'Indicadores principales y alertas.'],
    ['Cuentas', 'Saldos reales, saldo calculado y diferencia de auditoria.'],
    ['Auditoria cuentas', 'Recalculo por cuenta desde saldo inicial y movimientos.'],
    ['Movimientos', 'Libro mayor completo con IDs, origen, importaciones, prestamos y exclusiones.'],
    ['Movimientos por cuenta', 'Movimientos ordenados por cuenta con saldo acumulado.'],
    ['Deudas', 'Pendientes, abonos, cuentas asociadas y estado.'],
    ['Categorias', 'Totales por categoria y participacion.'],
    ['Mes a mes', 'Ingresos, gastos y balance por mes.'],
    ['Eliminados', 'Movimientos borrados recuperables exportados.'],
    ['Historial acciones', 'Bitacora de acciones importantes cuando exista permiso.'],
  ]);
}

function addExecutiveSummary(workbook: ExcelJS.Workbook, transactions: Transaction[], debts: Debt[], accounts: Account[]) {
  const report = buildMonthlyReport(transactions, debts);
  const sheet = workbook.addWorksheet('Resumen ejecutivo');
  const activeAccounts = accounts.filter((account) => account.active !== false);
  const availableBalance = activeAccounts.reduce((sum, account) => sum + account.currentBalance, 0);
  const historicalMovements = transactions.filter((tx) => tx.excludeFromReports).length;
  const receivable = debts.filter((d) => d.status !== 'paid' && d.direction === 'receivable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);
  const payable = debts.filter((d) => d.status !== 'paid' && d.direction === 'payable').reduce((sum, d) => sum + Math.max(0, d.amountOriginal - d.amountPaid), 0);

  sheet.columns = [{ header: 'Indicador', key: 'indicator', width: 38 }, { header: 'Valor', key: 'value', width: 28 }, { header: 'Nota', key: 'note', width: 70 }];
  sheet.addRows([
    { indicator: 'Ingresos del mes reportables', value: report.totalIncome, note: 'No incluye importaciones historicas ni movimientos excluidos de reportes.' },
    { indicator: 'Gastos del mes reportables', value: report.totalExpenses, note: 'No incluye prestamos/importaciones marcadas como historicas.' },
    { indicator: 'Balance del mes reportable', value: report.balance, note: 'Ingresos menos gastos del mes.' },
    { indicator: 'Tasa de ahorro estimada (%)', value: Number(report.savingsRate.toFixed(2)), note: 'Se calcula sobre movimientos reportables.' },
    { indicator: 'Categoria principal', value: report.topCategory ? `${report.topCategory[0]} (${money(report.topCategory[1]).toLocaleString('es-CO')})` : 'Sin datos', note: '' },
    { indicator: 'Saldo disponible en cuentas activas', value: availableBalance, note: 'Suma de saldos actuales de cuentas activas.' },
    { indicator: 'Te deben pendiente', value: receivable, note: 'Deudas por cobrar abiertas o parciales.' },
    { indicator: 'Tu debes pendiente', value: payable, note: 'Deudas por pagar abiertas o parciales.' },
    { indicator: 'Patrimonio operativo estimado', value: availableBalance + receivable - payable, note: 'Saldo disponible + te deben - tu debes.' },
    { indicator: 'Movimientos totales exportados', value: transactions.length, note: '' },
    { indicator: 'Movimientos historicos/excluidos', value: historicalMovements, note: 'No cuentan en reportes mensuales, pero si en auditoria de saldos.' },
  ]);
  styleSheet(sheet, [2]);

  const startRow = sheet.rowCount + 2;
  sheet.addRow([]);
  sheet.addRow(['Alertas y oportunidades']);
  sheet.getRow(startRow + 1).font = { bold: true, size: 13, color: { argb: 'FFBE185D' } };
  [...report.alerts.map((message) => ['Alerta', message]), ...report.opportunities.map((message) => ['Oportunidad', message])].forEach((row) => sheet.addRow(row));
}

function addAccountsSheet(workbook: ExcelJS.Workbook, accounts: Account[], transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Cuentas');
  sheet.columns = [
    { header: 'ID cuenta', key: 'id', width: 28 },
    { header: 'Cuenta', key: 'name', width: 28 },
    { header: 'Tipo', key: 'type', width: 16 },
    { header: 'Activa', key: 'active', width: 12 },
    { header: 'Saldo inicial', key: 'initialBalance', width: 16 },
    { header: 'Ingresos acumulados', key: 'income', width: 18 },
    { header: 'Gastos acumulados', key: 'expenses', width: 18 },
    { header: 'Saldo calculado', key: 'calculated', width: 16 },
    { header: 'Saldo actual app', key: 'currentBalance', width: 16 },
    { header: 'Diferencia auditoria', key: 'difference', width: 20 },
    { header: 'Movimientos', key: 'count', width: 14 },
    { header: 'Creada', key: 'createdAt', width: 18 },
    { header: 'Importacion lote', key: 'batchImportId', width: 28 },
  ];

  accounts.forEach((account) => {
    const txs = transactions.filter((tx) => tx.accountId === account.id || tx.accountName === account.name);
    const income = txs.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
    const expenses = txs.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
    const calculated = money(Number(account.initialBalance || 0) + income - expenses);
    const current = money(Number(account.currentBalance || 0));
    sheet.addRow({
      id: account.id,
      name: account.name,
      type: account.type,
      active: account.active === false ? 'No' : 'Si',
      initialBalance: account.initialBalance,
      income,
      expenses,
      calculated,
      currentBalance: current,
      difference: current - calculated,
      count: txs.length,
      createdAt: formatDateTime(account.createdAt),
      batchImportId: account.batchImportId || '',
    });
  });
  styleSheet(sheet, [5, 6, 7, 8, 9, 10]);
}

function addAccountAuditSheet(workbook: ExcelJS.Workbook, accounts: Account[], transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Auditoria cuentas');
  sheet.columns = [
    { header: 'Cuenta', key: 'account', width: 26 },
    { header: 'Saldo inicial', key: 'initial', width: 16 },
    { header: 'Total entradas', key: 'income', width: 16 },
    { header: 'Total salidas', key: 'expense', width: 16 },
    { header: 'Saldo esperado', key: 'expected', width: 16 },
    { header: 'Saldo app', key: 'current', width: 16 },
    { header: 'Diferencia', key: 'difference', width: 16 },
    { header: 'Estado', key: 'status', width: 18 },
    { header: 'Observacion', key: 'note', width: 70 },
  ];

  accounts.forEach((account) => {
    const txs = transactions.filter((tx) => tx.accountId === account.id || tx.accountName === account.name);
    const income = txs.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txs.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
    const expected = money(account.initialBalance + income - expense);
    const current = money(account.currentBalance);
    const difference = current - expected;
    sheet.addRow({
      account: account.name,
      initial: account.initialBalance,
      income,
      expense,
      expected,
      current,
      difference,
      status: Math.abs(difference) <= 1 ? 'OK' : 'Revisar',
      note: Math.abs(difference) <= 1 ? 'Saldo actual cuadra con movimientos exportados.' : 'Diferencia entre saldo calculado y saldo actual. Revisar ediciones, importaciones o datos externos.',
    });
  });
  styleSheet(sheet, [2, 3, 4, 5, 6, 7]);
}

function addTransactionsSheet(workbook: ExcelJS.Workbook, transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 28 },
    { header: 'Fecha', key: 'date', width: 16 },
    { header: 'Fecha y hora creacion', key: 'createdAt', width: 22 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Descripcion', key: 'description', width: 42 },
    { header: 'Categoria', key: 'category', width: 22 },
    { header: 'Cuenta', key: 'accountName', width: 24 },
    { header: 'Valor', key: 'amount', width: 16 },
    { header: 'Efecto saldo', key: 'effect', width: 16 },
    { header: 'Origen', key: 'source', width: 12 },
    { header: 'Reportable mes', key: 'reportable', width: 16 },
    { header: 'ID cuenta', key: 'accountId', width: 28 },
    { header: 'ID deuda', key: 'debtId', width: 28 },
    { header: 'Tipo mov. deuda', key: 'debtMovementKind', width: 22 },
    { header: 'ID importacion', key: 'batchImportId', width: 28 },
    { header: 'Fila importacion', key: 'importRow', width: 16 },
    { header: 'Texto original', key: 'rawText', width: 70 },
    { header: 'Actualizado', key: 'updatedAt', width: 22 },
  ];
  [...transactions]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .forEach((tx) => sheet.addRow({
      id: tx.id,
      date: formatDate(tx.date),
      createdAt: formatDateTime(tx.createdAt),
      type: tx.type === 'income' ? 'Ingreso' : 'Gasto',
      description: tx.description,
      category: tx.category,
      accountName: tx.accountName,
      amount: tx.amount,
      effect: moneyEffect(tx),
      source: tx.source,
      reportable: tx.excludeFromReports ? 'No - historico/auditoria' : 'Si',
      accountId: tx.accountId,
      debtId: (tx as any).debtId || '',
      debtMovementKind: (tx as any).debtMovementKind || '',
      batchImportId: tx.batchImportId || '',
      importRow: tx.importRow || '',
      rawText: tx.rawText || '',
      updatedAt: formatDateTime(tx.updatedAt),
    }));
  styleSheet(sheet, [8, 9]);
}

function addLedgerSheet(workbook: ExcelJS.Workbook, accounts: Account[], transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Movimientos por cuenta');
  sheet.columns = [
    { header: 'Cuenta', key: 'accountName', width: 24 },
    { header: 'Fecha', key: 'date', width: 16 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Descripcion', key: 'description', width: 45 },
    { header: 'Categoria', key: 'category', width: 20 },
    { header: 'Entrada', key: 'income', width: 16 },
    { header: 'Salida', key: 'expense', width: 16 },
    { header: 'Saldo acumulado calculado', key: 'running', width: 24 },
    { header: 'Reportable', key: 'reportable', width: 14 },
    { header: 'ID movimiento', key: 'id', width: 28 },
  ];

  accounts.forEach((account) => {
    let running = Number(account.initialBalance || 0);
    const txs = transactions
      .filter((tx) => tx.accountId === account.id || tx.accountName === account.name)
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
    sheet.addRow({ accountName: account.name, description: 'Saldo inicial', running, reportable: 'Base' });
    txs.forEach((tx) => {
      running += moneyEffect(tx);
      sheet.addRow({
        accountName: account.name,
        date: formatDate(tx.date),
        type: tx.type === 'income' ? 'Ingreso' : 'Gasto',
        description: tx.description,
        category: tx.category,
        income: tx.type === 'income' ? tx.amount : 0,
        expense: tx.type === 'expense' ? tx.amount : 0,
        running,
        reportable: tx.excludeFromReports ? 'No' : 'Si',
        id: tx.id,
      });
    });
  });
  styleSheet(sheet, [6, 7, 8]);
}

function addDebtsSheet(workbook: ExcelJS.Workbook, debts: Debt[]) {
  const sheet = workbook.addWorksheet('Deudas');
  sheet.columns = [
    { header: 'ID deuda', key: 'id', width: 28 },
    { header: 'Tipo', key: 'direction', width: 16 },
    { header: 'Persona', key: 'person', width: 24 },
    { header: 'Descripcion', key: 'description', width: 40 },
    { header: 'Valor inicial', key: 'original', width: 16 },
    { header: 'Abonado', key: 'paid', width: 16 },
    { header: 'Pendiente', key: 'remaining', width: 16 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Cuenta inicial', key: 'linkedAccountName', width: 24 },
    { header: 'Ultima cuenta pago', key: 'lastPaymentAccountName', width: 24 },
    { header: 'Fecha pactada', key: 'due', width: 16 },
    { header: 'Cerrada', key: 'closedAt', width: 18 },
    { header: 'Notas', key: 'notes', width: 50 },
  ];
  debts.forEach((debt) => sheet.addRow({
    id: debt.id,
    direction: debt.direction === 'receivable' ? 'Me deben' : 'Yo debo',
    person: debt.personName,
    description: debt.description,
    original: debt.amountOriginal,
    paid: debt.amountPaid,
    remaining: Math.max(0, debt.amountOriginal - debt.amountPaid),
    status: debt.status,
    linkedAccountName: (debt as any).linkedAccountName || '',
    lastPaymentAccountName: (debt as any).lastPaymentAccountName || '',
    due: formatDate(debt.dueDate),
    closedAt: formatDateTime(debt.closedAt),
    notes: debt.notes || '',
  }));
  styleSheet(sheet, [5, 6, 7]);
}

function addCategoriesSheet(workbook: ExcelJS.Workbook, transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Categorias');
  sheet.columns = [
    { header: 'Categoria', key: 'category', width: 28 },
    { header: 'Gasto reportable', key: 'expense', width: 18 },
    { header: 'Ingreso reportable', key: 'income', width: 18 },
    { header: 'Movimiento historico/excluido', key: 'excluded', width: 24 },
    { header: 'Cantidad', key: 'count', width: 12 },
  ];
  const map = new Map<string, { expense: number; income: number; excluded: number; count: number }>();
  transactions.forEach((tx) => {
    const item = map.get(tx.category) || { expense: 0, income: 0, excluded: 0, count: 0 };
    item.count += 1;
    if (tx.excludeFromReports) item.excluded += tx.amount;
    else if (tx.type === 'expense') item.expense += tx.amount;
    else item.income += tx.amount;
    map.set(tx.category, item);
  });
  [...map.entries()].sort((a, b) => (b[1].expense + b[1].income + b[1].excluded) - (a[1].expense + a[1].income + a[1].excluded)).forEach(([category, item]) => sheet.addRow({ category, ...item }));
  styleSheet(sheet, [2, 3, 4]);
}

function addMonthlySheet(workbook: ExcelJS.Workbook, transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('Mes a mes');
  sheet.columns = [
    { header: 'Mes', key: 'month', width: 14 },
    { header: 'Ingresos reportables', key: 'income', width: 20 },
    { header: 'Gastos reportables', key: 'expense', width: 20 },
    { header: 'Balance reportable', key: 'balance', width: 20 },
    { header: 'Historicos/excluidos', key: 'excluded', width: 20 },
    { header: 'Movimientos', key: 'count', width: 14 },
  ];
  const map = new Map<string, { income: number; expense: number; excluded: number; count: number }>();
  transactions.forEach((tx) => {
    const month = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}`;
    const item = map.get(month) || { income: 0, expense: 0, excluded: 0, count: 0 };
    item.count += 1;
    if (tx.excludeFromReports) item.excluded += tx.amount;
    else if (tx.type === 'income') item.income += tx.amount;
    else item.expense += tx.amount;
    map.set(month, item);
  });
  [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([month, item]) => sheet.addRow({ month, income: item.income, expense: item.expense, balance: item.income - item.expense, excluded: item.excluded, count: item.count }));
  styleSheet(sheet, [2, 3, 4, 5]);
}

function addDeletedSheet(workbook: ExcelJS.Workbook, deletedTransactions: DeletedTransaction[]) {
  const sheet = workbook.addWorksheet('Eliminados');
  sheet.columns = [
    { header: 'ID eliminado', key: 'deletedId', width: 28 },
    { header: 'ID original', key: 'originalId', width: 28 },
    { header: 'Borrado', key: 'deletedAt', width: 22 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Descripcion', key: 'description', width: 42 },
    { header: 'Categoria', key: 'category', width: 20 },
    { header: 'Cuenta', key: 'accountName', width: 24 },
    { header: 'Valor', key: 'amount', width: 16 },
    { header: 'Recuperable', key: 'recoverable', width: 14 },
  ];
  deletedTransactions.forEach((tx) => sheet.addRow({
    deletedId: tx.deletedId,
    originalId: tx.originalId,
    deletedAt: formatDateTime(tx.deletedAt),
    type: tx.type === 'income' ? 'Ingreso' : 'Gasto',
    description: tx.description,
    category: tx.category,
    accountName: tx.accountName,
    amount: tx.amount,
    recoverable: tx.recoverable === false ? 'No' : 'Si',
  }));
  styleSheet(sheet, [8]);
}

function addActionLogSheet(workbook: ExcelJS.Workbook, actionLogs: ActionLog[]) {
  const sheet = workbook.addWorksheet('Historial acciones');
  sheet.columns = [
    { header: 'Fecha', key: 'createdAt', width: 22 },
    { header: 'Accion', key: 'action', width: 28 },
    { header: 'Entidad', key: 'entityType', width: 18 },
    { header: 'ID entidad', key: 'entityId', width: 28 },
    { header: 'Descripcion', key: 'description', width: 60 },
    { header: 'Origen', key: 'source', width: 14 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Antes', key: 'before', width: 60 },
    { header: 'Despues', key: 'after', width: 60 },
  ];
  actionLogs.forEach((log) => sheet.addRow({
    createdAt: formatDateTime(log.createdAt),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId || '',
    description: log.description,
    source: log.source,
    status: log.status,
    before: jsonPreview(log.before),
    after: jsonPreview(log.after),
  }));
  styleSheet(sheet);
}

function addRestoreSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('Guia restauracion');
  sheet.columns = [{ width: 34 }, { width: 100 }];
  sheet.addRow(['Tema', 'Indicacion']);
  sheet.addRows([
    ['Backup completo', 'Este archivo es una copia organizada para auditoria. No restaura automaticamente la base de datos.'],
    ['Movimientos', 'La hoja Movimientos conserva IDs, cuenta, categoria, origen, texto original y marcas de importacion/prestamo.'],
    ['Cuentas', 'La hoja Auditoria cuentas muestra si los saldos actuales cuadran contra saldo inicial + ingresos - gastos.'],
    ['Historicos/excluidos', 'Los movimientos con Reportable mes = No no inflan reportes mensuales, pero si sirven para cuadrar saldos reales.'],
    ['Deudas', 'La hoja Deudas muestra cuentas iniciales y ultimas cuentas de pago cuando existen.'],
    ['Restauracion manual', 'Para reconstruir datos, usar IDs y hojas de movimientos/cuentas/deudas como fuente de verdad.'],
  ]);
  styleSheet(sheet);
}

export async function exportFinanceWorkbook(params: {
  transactions: Transaction[];
  debts: Debt[];
  accounts: Account[];
  deletedTransactions?: DeletedTransaction[];
  actionLogs?: ActionLog[];
  fileName?: string;
}) {
  const {
    transactions,
    debts,
    accounts,
    deletedTransactions = [],
    actionLogs = [],
    fileName = 'respaldo-financiero-profesional.xlsx',
  } = params;

  const generatedAt = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ingresos y Egresos Hogar';
  workbook.lastModifiedBy = 'Ingresos y Egresos Hogar';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.subject = 'Backup completo financiero';
  workbook.title = 'Respaldo completo finanzas hogar';
  workbook.company = 'Ingresos y Egresos Hogar';

  addCoverSheet(workbook, { transactions, debts, accounts, deletedTransactions, actionLogs, generatedAt });
  addExecutiveSummary(workbook, transactions, debts, accounts);
  addAccountsSheet(workbook, accounts, transactions);
  addAccountAuditSheet(workbook, accounts, transactions);
  addTransactionsSheet(workbook, transactions);
  addLedgerSheet(workbook, accounts, transactions);
  addDebtsSheet(workbook, debts);
  addCategoriesSheet(workbook, transactions);
  addMonthlySheet(workbook, transactions);
  addDeletedSheet(workbook, deletedTransactions);
  addActionLogSheet(workbook, actionLogs);
  addRestoreSheet(workbook);

  workbook.eachSheet((sheet) => {
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  });

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
