export type BatchImportMovement = { description: string; amount: number };
export type BatchImportPreview = {
  accountName: string;
  totalValue: number;
  expectedMovementsTotal: number;
  expectedPendingBalance: number;
  calculatedMovementsTotal: number;
  calculatedPendingBalance: number;
  movements: BatchImportMovement[];
  rawText: string;
};

export function parseCOPInteger(value: string): number {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

function labeledAmount(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match?.[1] ? parseCOPInteger(match[1]) : 0;
}

function normalizeLabel(value: string): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseBatchImportText(text: string): BatchImportPreview | null {
  const accountName = text.match(/nombre\s+de\s+la\s+cuenta\s*:\s*(.+)/i)?.[1]?.trim();
  const totalValue = labeledAmount(text, /(?:valor\s+inicial(?:\s*\/\s*total\s+de\s+la\s+cuenta)?|valor\s+inicial|total\s+de\s+la\s+cuenta)\s*:\s*\$?\s*([\d.,]+)/i);
  const expectedMovementsTotal = labeledAmount(text, /total\s+de\s+movimientos[^:\n]*:\s*\$?\s*([\d.,]+)/i);
  const expectedPendingBalance = labeledAmount(text, /saldo\s+pendiente\s*:\s*\$?\s*([\d.,]+)/i);
  const block = text.split(/movimientos\s*:/i).slice(1).join('Movimientos:');
  const movements: BatchImportMovement[] = [];

  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+[\).]\s*(.+?)\s*(?:\u2014|\u2013|-)\s*\$?\s*([\d.,]+)/);
    if (!match) continue;
    const description = match[1].trim();
    if (normalizeLabel(description) === '16 de febrero') continue;
    const amount = parseCOPInteger(match[2]);
    if (description && amount > 0) movements.push({ description, amount });
  }

  if (!accountName || !totalValue || !expectedMovementsTotal || !expectedPendingBalance || !movements.length) return null;
  const calculatedMovementsTotal = movements.reduce((sum, movement) => sum + movement.amount, 0);
  const calculatedPendingBalance = totalValue - calculatedMovementsTotal;
  return { accountName, totalValue, expectedMovementsTotal, expectedPendingBalance, calculatedMovementsTotal, calculatedPendingBalance, movements, rawText: text };
}

export function validateBatchImportPreview(preview: BatchImportPreview): string | null {
  if (preview.movements.length > 450) return 'Hay demasiados movimientos para un solo lote.';
  if (Math.abs(preview.calculatedMovementsTotal - preview.expectedMovementsTotal) > 1) return 'La suma de movimientos no cuadra.';
  if (Math.abs(preview.calculatedPendingBalance - preview.expectedPendingBalance) > 1) return 'El saldo pendiente no cuadra.';
  return null;
}
