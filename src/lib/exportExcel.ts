import * as XLSX from 'xlsx';
import type { Transaction } from '../types';

function toSafeDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function exportTransactionsToExcel(transactions: Transaction[], fileName = 'finanzas-organizadas.xlsx') {
  const rows = transactions.map((tx) => {
    const date = toSafeDate(tx.date);
    return {
      Fecha: date.toLocaleDateString('es-CO'),
      Tipo: tx.type === 'income' ? 'Ingreso' : 'Gasto',
      Descripción: tx.description,
      Categoría: tx.category,
      Cuenta: tx.accountName,
      Valor: tx.amount,
      Moneda: tx.currency || 'COP',
      Origen: tx.source || '',
      Confianza: tx.confidence ?? '',
    };
  });

  const totalIncome = transactions.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalExpenses = transactions.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  const workbook = XLSX.utils.book_new();
  const txSheet = XLSX.utils.json_to_sheet(rows);
  const summarySheet = XLSX.utils.json_to_sheet([
    { Indicador: 'Total ingresos', Valor: totalIncome },
    { Indicador: 'Total gastos', Valor: totalExpenses },
    { Indicador: 'Balance', Valor: totalIncome - totalExpenses },
    { Indicador: 'Movimientos exportados', Valor: transactions.length },
    { Indicador: 'Fecha de exportación', Valor: new Date().toLocaleString('es-CO') },
  ]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');
  XLSX.utils.book_append_sheet(workbook, txSheet, 'Movimientos');
  XLSX.writeFile(workbook, fileName);
}
