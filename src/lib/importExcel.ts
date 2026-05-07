import * as XLSX from 'xlsx';
import type { Account, TransactionType } from '../types';

export interface ImportedTransactionDraft {
  type: TransactionType;
  amount: number;
  currency: 'COP';
  category: string;
  accountId: string;
  accountName: string;
  description: string;
  date: Date;
  rawText: string;
  source: 'manual';
  confidence: number;
}

export interface ImportPreviewResult {
  rowsRead: number;
  drafts: ImportedTransactionDraft[];
  skipped: string[];
}

const INCOME_HEADERS = ['ingreso', 'ingresos', 'entrada', 'entradas', 'abono', 'entró', 'entro', 'recibido', 'debe'];
const EXPENSE_HEADERS = ['gasto', 'gastos', 'egreso', 'egresos', 'salida', 'salidas', 'pago', 'pagos', 'haber'];
const AMOUNT_HEADERS = ['valor', 'monto', 'total', 'importe', 'cantidad', 'amount'];
const DATE_HEADERS = ['fecha', 'date', 'dia', 'día'];
const DESCRIPTION_HEADERS = ['descripcion', 'descripción', 'concepto', 'detalle', 'movimiento', 'nombre', 'nota', 'notas'];
const CATEGORY_HEADERS = ['categoria', 'categoría', 'rubro', 'tipo'];
const ACCOUNT_HEADERS = ['cuenta', 'medio', 'banco', 'wallet', 'forma de pago', 'metodo', 'método'];

function normalize(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function headerIncludes(header: string, candidates: string[]) {
  const normalized = normalize(header);
  return candidates.some((candidate) => normalized.includes(normalize(candidate)));
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Math.abs(value);
  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function parseSignedAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  const negative = text.includes('-') || text.startsWith('(');
  const amount = parseAmount(text);
  return negative ? -amount : amount;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0);
  }
  const text = String(value || '').trim();
  if (!text) return new Date();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return new Date(year, month, day, 12, 0, 0);
  }
  return new Date();
}

function inferCategory(description: string, type: TransactionType): string {
  if (type === 'income') return 'Ingreso';
  const text = normalize(description);
  if (['comida', 'mercado', 'almuerzo', 'cafe', 'restaurante', 'tienda', 'panaderia'].some((word) => text.includes(word))) return 'Alimentación';
  if (['bus', 'taxi', 'uber', 'gasolina', 'transporte', 'pasaje', 'parqueadero'].some((word) => text.includes(word))) return 'Transporte';
  if (['arriendo', 'luz', 'agua', 'gas', 'internet', 'hogar', 'servicio'].some((word) => text.includes(word))) return 'Hogar';
  if (['medicina', 'farmacia', 'salud', 'doctor', 'cita'].some((word) => text.includes(word))) return 'Salud';
  if (['colegio', 'universidad', 'curso', 'educacion'].some((word) => text.includes(word))) return 'Educación';
  return 'Otros';
}

function findHeader(headers: string[], candidates: string[]) {
  return headers.find((header) => headerIncludes(header, candidates));
}

function chooseAccount(accounts: Account[], rawAccount: unknown): Account | null {
  const wanted = normalize(rawAccount);
  if (wanted) {
    const exact = accounts.find((account) => normalize(account.name) === wanted);
    if (exact) return exact;
    const partial = accounts.find((account) => wanted.includes(normalize(account.name)) || normalize(account.name).includes(wanted));
    if (partial) return partial;
  }
  return accounts.find((account) => normalize(account.name) === 'efectivo') || accounts[0] || null;
}

export async function parseExcelFile(file: File, accounts: Account[]): Promise<ImportPreviewResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const drafts: ImportedTransactionDraft[] = [];
  const skipped: string[] = [];

  rows.forEach((row, index) => {
    const headers = Object.keys(row);
    const dateHeader = findHeader(headers, DATE_HEADERS);
    const descriptionHeader = findHeader(headers, DESCRIPTION_HEADERS);
    const categoryHeader = findHeader(headers, CATEGORY_HEADERS);
    const accountHeader = findHeader(headers, ACCOUNT_HEADERS);
    const incomeHeader = findHeader(headers, INCOME_HEADERS);
    const expenseHeader = findHeader(headers, EXPENSE_HEADERS);
    const amountHeader = findHeader(headers, AMOUNT_HEADERS);

    const description = String(descriptionHeader ? row[descriptionHeader] : '').trim() || `Movimiento importado fila ${index + 2}`;
    const account = chooseAccount(accounts, accountHeader ? row[accountHeader] : '');
    if (!account) {
      skipped.push(`Fila ${index + 2}: no hay cuenta disponible.`);
      return;
    }

    let type: TransactionType | null = null;
    let amount = 0;

    const incomeAmount = incomeHeader ? parseAmount(row[incomeHeader]) : 0;
    const expenseAmount = expenseHeader ? parseAmount(row[expenseHeader]) : 0;
    const signedAmount = amountHeader ? parseSignedAmount(row[amountHeader]) : 0;

    if (incomeAmount > 0) {
      type = 'income';
      amount = incomeAmount;
    } else if (expenseAmount > 0) {
      type = 'expense';
      amount = expenseAmount;
    } else if (signedAmount !== 0) {
      type = signedAmount < 0 ? 'expense' : 'income';
      amount = Math.abs(signedAmount);
    }

    if (!type || amount <= 0) {
      skipped.push(`Fila ${index + 2}: no pude detectar valor de ingreso/gasto.`);
      return;
    }

    const explicitCategory = categoryHeader ? String(row[categoryHeader] || '').trim() : '';
    drafts.push({
      type,
      amount,
      currency: 'COP',
      category: explicitCategory || inferCategory(description, type),
      accountId: account.id,
      accountName: account.name,
      description,
      date: parseDate(dateHeader ? row[dateHeader] : ''),
      rawText: JSON.stringify(row),
      source: 'manual',
      confidence: 0.85,
    });
  });

  return { rowsRead: rows.length, drafts, skipped: skipped.slice(0, 20) };
}
