import type { Account, Debt, Transaction } from '../types';
import { buildFinanceWorkbook, exportFinanceWorkbook } from './reporting';

/**
 * @deprecated Exportador legacy conservado solo por compatibilidad.
 * No calcula ingresos/gastos por tx.type. Delega al motor contable de reporting.ts.
 */
export function buildTransactionsWorkbookFromAccounting(params: { accounts: Account[]; transactions: Transaction[]; debts?: Debt[] }) {
  return buildFinanceWorkbook({ accounts: params.accounts, transactions: params.transactions, debts: params.debts || [] });
}

/**
 * @deprecated Usa exportFinanceWorkbook({ accounts, transactions, debts }) cuando sea posible.
 * Esta firma exige cuentas para evitar exportar con reglas antiguas incompletas.
 */
export async function exportTransactionsToExcel(transactions: Transaction[], fileName = 'finanzas-organizadas.xlsx', accounts: Account[] = [], debts: Debt[] = []) {
  if (!accounts.length) {
    throw new Error('Exportacion legacy bloqueada: se necesitan cuentas para calcular con el motor contable. Usa exportFinanceWorkbook.');
  }
  return exportFinanceWorkbook({ accounts, transactions, debts, fileName });
}
