import ExcelJS from 'exceljs';
import type { Transaction } from '../types';

function toSafeDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function exportTransactionsToExcel(transactions: Transaction[], fileName = 'finanzas-organizadas.xlsx') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ingresos y Egresos Hogar';
  workbook.created = new Date();

  const totalIncome = transactions.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalExpenses = transactions.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [
    { header: 'Indicador', key: 'indicator', width: 28 },
    { header: 'Valor', key: 'value', width: 22 },
  ];
  summary.addRows([
    { indicator: 'Total ingresos', value: totalIncome },
    { indicator: 'Total gastos', value: totalExpenses },
    { indicator: 'Balance', value: totalIncome - totalExpenses },
    { indicator: 'Movimientos exportados', value: transactions.length },
    { indicator: 'Fecha de exportación', value: new Date().toLocaleString('es-CO') },
  ]);

  const movements = workbook.addWorksheet('Movimientos');
  movements.columns = [
    { header: 'Fecha', key: 'date', width: 16 },
    { header: 'Tipo', key: 'type', width: 12 },
    { header: 'Descripción', key: 'description', width: 38 },
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Cuenta', key: 'account', width: 18 },
    { header: 'Valor', key: 'amount', width: 16 },
    { header: 'Moneda', key: 'currency', width: 10 },
    { header: 'Origen', key: 'source', width: 14 },
    { header: 'Confianza', key: 'confidence', width: 12 },
  ];

  transactions.forEach((tx) => {
    const date = toSafeDate(tx.date);
    movements.addRow({
      date: date.toLocaleDateString('es-CO'),
      type: tx.type === 'income' ? 'Ingreso' : 'Gasto',
      description: tx.description,
      category: tx.category,
      account: tx.accountName,
      amount: tx.amount,
      currency: tx.currency || 'COP',
      source: tx.source || '',
      confidence: tx.confidence ?? '',
    });
  });

  [summary, movements].forEach((sheet) => {
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
