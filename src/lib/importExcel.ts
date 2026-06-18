import ExcelJS from 'exceljs';
import type { Account, TransactionType } from '../types';
import { parseCurrencyInput } from './accounting';

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

type RowData = Record<string, unknown>;

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

// Parseo de montos en pesos COP enteros. Antes esta funcion trataba la coma
// como decimal y solo quitaba puntos de miles: "1,250,000" salia 1, "45,000"
// salia 45 (perdida silenciosa de factor 1000x en exports con coma de miles o
// formato US). Ahora reusa el parser canonico parseCurrencyInput (mismo que el
// resto de la app), y solo si este lo considera ambiguo cae a "solo digitos".
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Math.abs(Math.round(value));
  const text = String(value || '').trim();
  if (!text) return 0;
  try {
    return parseCurrencyInput(text);
  } catch {
    const digits = text.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  }
}

export function parseSignedAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  const negative = text.includes('-') || text.startsWith('(');
  const amount = parseAmount(text);
  return negative ? -amount : amount;
}

function excelSerialDateToDate(value: number): Date | null {
  if (value < 20000 || value > 80000) return null;
  const utcDays = Math.floor(value - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate(), 12, 0, 0);
}

// Devuelve null cuando HAY un texto de fecha pero no se entiende, para que la
// fila se marque como dudosa en vez de quedar silenciosamente con la fecha de
// HOY (lo que metia un gasto antiguo en el mes en curso y distorsionaba el
// reporte). Si no hay fecha (celda/columna vacia) si se asume hoy a proposito.
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const excelDate = excelSerialDateToDate(value);
    if (excelDate) return excelDate;
  }
  const text = String(value || '').trim();
  if (!text) return new Date();
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    const d = new Date(year, month, day, 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
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

function cellToValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;

  if ('text' in value && value.text) return value.text;
  if ('result' in value && value.result !== undefined) return value.result;
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('hyperlink' in value && 'text' in value) return value.text;

  return String(value);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

async function readCsvRows(file: File): Promise<RowData[]> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce<RowData>((row, header, index) => {
      row[header || `Columna ${index + 1}`] = values[index] || '';
      return row;
    }, {});
  });
}

async function readWorkbookRows(file: File): Promise<RowData[]> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let headerRowNumber = 1;
  let headers: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (headers.length > 0) return;
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = String(cellToValue(cell.value) || '').trim();
    });
    if (values.some(Boolean)) {
      headerRowNumber = rowNumber;
      headers = values.map((header, index) => header || `Columna ${index + 1}`);
    }
  });

  if (headers.length === 0) return [];

  const rows: RowData[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const record = headers.reduce<RowData>((acc, header) => {
      acc[header] = '';
      return acc;
    }, {});
    let hasValue = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1] || `Columna ${colNumber}`;
      const value = cellToValue(cell.value);
      if (String(value || '').trim()) hasValue = true;
      record[header] = value;
    });

    if (hasValue) rows.push(record);
  });

  return rows;
}

function buildDraftsFromRows(rows: RowData[], accounts: Account[]): ImportPreviewResult {
  const drafts: ImportedTransactionDraft[] = [];
  const skipped: string[] = [];

  rows.forEach((row: RowData, index: number) => {
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

    const date = parseDate(dateHeader ? row[dateHeader] : '');
    if (!date) {
      skipped.push(`Fila ${index + 2}: no entendi la fecha "${String(row[dateHeader as string] ?? '')}". Revisala (usa dd/mm/aaaa) y reintenta.`);
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
      date,
      rawText: JSON.stringify(row),
      source: 'manual',
      confidence: 0.85,
    });
  });

  return { rowsRead: rows.length, drafts, skipped: skipped.slice(0, 20) };
}

export async function parseExcelFile(file: File, accounts: Account[]): Promise<ImportPreviewResult> {
  const isCsv = /\.csv$/i.test(file.name);
  const rows = isCsv ? await readCsvRows(file) : await readWorkbookRows(file);
  return buildDraftsFromRows(rows, accounts);
}
