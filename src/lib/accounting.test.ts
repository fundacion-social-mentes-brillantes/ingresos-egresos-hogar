import { describe, expect, it } from 'vitest';
import type { Account, Debt, Transaction } from '../types';
import {
  buildAccountingLedger,
  buildFinancialSummaryForPeriod,
  calculateReconciliation,
  inferMovementKind,
  isReportableFinancialTransaction,
  parseCurrencyInput,
} from './accounting';
import { genericReversalBlockReason } from './accountingOperations';
import { buildFinanceWorkbook, buildMonthlyReport } from './reporting';
import { exportTransactionsToExcel } from './exportExcel';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id || 'bank',
    name: overrides.name || 'Banco',
    type: overrides.type || 'bank',
    initialBalance: overrides.initialBalance ?? 3_556_319,
    currentBalance: overrides.currentBalance ?? 2_912_319,
    realBalance: overrides.realBalance,
    active: overrides.active ?? true,
    createdAt: overrides.createdAt || new Date('2026-01-01T12:00:00'),
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id || crypto.randomUUID(),
    type: overrides.type || 'expense',
    amount: overrides.amount ?? 1_000,
    currency: 'COP',
    category: overrides.category || 'Otros',
    accountId: overrides.accountId || 'bank',
    accountName: overrides.accountName || 'Banco',
    description: overrides.description || 'Movimiento',
    date: overrides.date || new Date(),
    rawText: overrides.rawText || '',
    source: overrides.source || 'manual',
    confidence: overrides.confidence ?? 1,
    createdAt: overrides.createdAt || new Date('2026-05-01T12:00:00'),
    updatedAt: overrides.updatedAt || new Date('2026-05-01T12:00:00'),
    ...overrides,
  };
}

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: overrides.id || 'debt-1',
    direction: overrides.direction || 'receivable',
    personName: overrides.personName || 'Juan',
    amountOriginal: overrides.amountOriginal ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    currency: 'COP',
    description: overrides.description || 'Prestamo',
    status: overrides.status || 'open',
    source: overrides.source || 'manual',
    createdAt: overrides.createdAt || new Date('2026-05-01T12:00:00'),
    updatedAt: overrides.updatedAt || new Date('2026-05-01T12:00:00'),
    ...overrides,
  };
}

describe('parseCurrencyInput', () => {
  it('parses Colombian peso formats as integer pesos', () => {
    expect(parseCurrencyInput('45000')).toBe(45_000);
    expect(parseCurrencyInput('45.000')).toBe(45_000);
    expect(parseCurrencyInput('$45.000')).toBe(45_000);
    expect(parseCurrencyInput('599.000')).toBe(599_000);
    expect(parseCurrencyInput('2.912.319')).toBe(2_912_319);
    expect(parseCurrencyInput('2,912,319')).toBe(2_912_319);
  });

  it('rejects ambiguous or invalid money', () => {
    expect(() => parseCurrencyInput('45,50')).toThrow();
    expect(() => parseCurrencyInput('-1000')).toThrow();
    expect(() => parseCurrencyInput('abc')).toThrow();
  });
});

describe('protected generic reversals', () => {
  it('blocks transfers from generic reversal', () => {
    expect(genericReversalBlockReason(tx({ transferId: 'tr1', transferDirection: 'out', movementKind: 'transfer_out' }))).toMatch(/reverseTransfer/i);
  });

  it('blocks debt movements from generic reversal', () => {
    expect(genericReversalBlockReason(tx({ debtId: 'd1', debtMovementKind: 'loan_principal_out', movementKind: 'loan_given' }))).toMatch(/Deudas/i);
  });

  it('blocks already reversed and reversal transactions', () => {
    expect(genericReversalBlockReason(tx({ isReversed: true }))).toMatch(/ya fue reversado/i);
    expect(genericReversalBlockReason(tx({ reversalOf: 'old' }))).toMatch(/reverso no se reversa/i);
  });

  it('blocks imported historical movements from generic reversal', () => {
    expect(genericReversalBlockReason(tx({ batchImportId: 'batch1', movementKind: 'historical_non_reportable', excludeFromReports: true }))).toMatch(/historico|importado/i);
  });
});

describe('movement classification', () => {
  it('infers transfer, debt and historical kinds from legacy data', () => {
    expect(inferMovementKind(tx({ transferDirection: 'out', transferId: 't1' }))).toBe('transfer_out');
    expect(inferMovementKind(tx({ type: 'income', transferDirection: 'in', transferId: 't1' }))).toBe('transfer_in');
    expect(inferMovementKind(tx({ debtMovementKind: 'loan_principal_out' }))).toBe('loan_given');
    expect(inferMovementKind(tx({ debtMovementKind: 'debt_payment_in', type: 'income' }))).toBe('loan_payment_received');
    expect(inferMovementKind(tx({ excludeFromReports: true }))).toBe('historical_non_reportable');
  });
});

describe('ledger accounting', () => {
  it('separates reportable expenses from historical non-reportable expenses', () => {
    const ledger = buildAccountingLedger(
      [account()],
      [
        tx({ id: 'hist', amount: 599_000, excludeFromReports: true, category: 'Abono / Descuento' }),
        tx({ id: 'g1', amount: 25_000, category: 'Alimentacion' }),
        tx({ id: 'g2', amount: 20_000, category: 'Transporte' }),
      ]
    );
    expect(ledger.byAccount.bank.gastosReportablesOPresentes).toBe(45_000);
    expect(ledger.byAccount.bank.gastosHistoricosNoReportables).toBe(599_000);
    expect(ledger.byAccount.bank.salidasFisicasTotales).toBe(644_000);
  });

  it('shows a 5.000 reconciliation difference when real balance differs from calculated balance', () => {
    const result = calculateReconciliation(3_556_319, 3_551_319);
    expect(result.estado).toBe('descuadre');
    expect(result.label).not.toBe('Cuadra');
    expect(result.diferencia).toBe(-5_000);
  });

  it('keeps global balance unchanged by transfers', () => {
    const accounts = [
      account({ id: 'bank', name: 'Banco', initialBalance: 100_000, currentBalance: 90_000 }),
      account({ id: 'cash', name: 'Efectivo', type: 'cash', initialBalance: 0, currentBalance: 10_000 }),
    ];
    const transactions = [
      tx({ id: 'out', accountId: 'bank', accountName: 'Banco', amount: 10_000, transferId: 'tr1', transferDirection: 'out', category: 'Transferencia entre cuentas' }),
      tx({ id: 'in', type: 'income', accountId: 'cash', accountName: 'Efectivo', amount: 10_000, transferId: 'tr1', transferDirection: 'in', category: 'Transferencia entre cuentas' }),
    ];
    const ledger = buildAccountingLedger(accounts, transactions);
    expect(ledger.global.saldoFisicoCalculado).toBe(100_000);
    expect(ledger.global.ingresosReportables).toBe(0);
    expect(ledger.global.gastosReportablesOPresentes).toBe(0);
  });

  it('handles loans and debt payments without reporting them as income or expenses', () => {
    const ledger = buildAccountingLedger(
      [account({ initialBalance: 500_000, currentBalance: 450_000 })],
      [
        tx({ id: 'loan', amount: 100_000, debtId: 'd1', debtMovementKind: 'loan_principal_out', category: 'Prestamo entregado', excludeFromReports: true }),
        tx({ id: 'payment', type: 'income', amount: 50_000, debtId: 'd1', debtMovementKind: 'debt_payment_in', category: 'Pago deuda recibida', excludeFromReports: true }),
      ],
      [debt({ id: 'd1', direction: 'receivable', amountOriginal: 100_000, amountPaid: 50_000 })]
    );
    expect(ledger.byAccount.bank.prestamosOtorgados).toBe(100_000);
    expect(ledger.byAccount.bank.abonosADeudasPorCobrar).toBe(50_000);
    expect(ledger.byAccount.bank.gastosReportablesOPresentes).toBe(0);
    expect(ledger.byAccount.bank.ingresosReportables).toBe(0);
    expect(ledger.global.deudasPorCobrarPendientes).toBe(50_000);
  });

  it('handles received loan and debt payment without reporting them as normal income or expense', () => {
    const ledger = buildAccountingLedger(
      [account({ initialBalance: 0, currentBalance: 60_000 })],
      [
        tx({ id: 'loan-in', type: 'income', amount: 100_000, debtId: 'p1', debtMovementKind: 'loan_principal_in', category: 'Prestamo recibido', excludeFromReports: true }),
        tx({ id: 'payment-out', type: 'expense', amount: 40_000, debtId: 'p1', debtMovementKind: 'debt_payment_out', category: 'Pago deuda pagada', excludeFromReports: true }),
      ],
      [debt({ id: 'p1', direction: 'payable', amountOriginal: 100_000, amountPaid: 40_000 })]
    );
    expect(ledger.byAccount.bank.prestamosRecibidos).toBe(100_000);
    expect(ledger.byAccount.bank.abonosADeudasPorPagar).toBe(40_000);
    expect(ledger.global.deudasPorPagarPendientes).toBe(60_000);
    expect(ledger.global.ingresosReportables).toBe(0);
    expect(ledger.global.gastosReportablesOPresentes).toBe(0);
  });

  it('records payable expense creation without reducing cash, then payment without duplicating reportable expense', () => {
    const ledger = buildAccountingLedger(
      [account({ initialBalance: 200_000, currentBalance: 150_000 })],
      [
        tx({ id: 'payable-created', amount: 50_000, movementKind: 'payable_expense_created', category: 'Compra fiada' }),
        tx({ id: 'payable-paid', amount: 50_000, movementKind: 'payable_expense_paid', category: 'Pago compra fiada', excludeFromReports: true }),
      ]
    );
    expect(ledger.byAccount.bank.gastosReportablesOPresentes).toBe(50_000);
    expect(ledger.byAccount.bank.gastosPendientesCreados).toBe(50_000);
    expect(ledger.byAccount.bank.gastosPendientesPagados).toBe(50_000);
    expect(ledger.byAccount.bank.salidasFisicasTotales).toBe(50_000);
  });

  it('models safe edit as reverse original plus corrected movement', () => {
    const transactions = [
      tx({ id: 'original', type: 'expense', amount: 20_000, isReversed: true }),
      tx({ id: 'reverse', type: 'income', amount: 20_000, reversalOf: 'original', excludeFromReports: true, movementKind: 'reconciliation_adjustment' }),
      tx({ id: 'corrected', type: 'expense', amount: 15_000, category: 'Corregido' }),
    ];
    const ledger = buildAccountingLedger([account({ initialBalance: 100_000 })], transactions);
    expect(ledger.byAccount.bank.salidasFisicasTotales).toBe(15_000);
    expect(ledger.byAccount.bank.gastosReportablesOPresentes).toBe(15_000);
  });

  it('models paper bin delete as reversal that removes cash/reporting effect', () => {
    const transactions = [
      tx({ id: 'deleted', type: 'income', amount: 30_000, isReversed: true }),
      tx({ id: 'reverse-delete', type: 'expense', amount: 30_000, reversalOf: 'deleted', excludeFromReports: true, movementKind: 'reconciliation_adjustment' }),
    ];
    const ledger = buildAccountingLedger([account({ initialBalance: 100_000 })], transactions);
    expect(ledger.byAccount.bank.ingresosReportables).toBe(0);
    expect(ledger.byAccount.bank.ingresosFisicos).toBe(0);
    expect(ledger.byAccount.bank.salidasFisicasTotales).toBe(0);
  });

  it('models debt voiding as reversing all associated debt money movements', () => {
    const ledger = buildAccountingLedger(
      [account({ initialBalance: 100_000 })],
      [
        tx({ id: 'loan', amount: 100_000, debtId: 'd1', debtMovementKind: 'loan_principal_out', excludeFromReports: true, isReversed: true }),
        tx({ id: 'loan-reverse', type: 'income', amount: 100_000, debtId: 'd1', reversalOf: 'loan', excludeFromReports: true, movementKind: 'reconciliation_adjustment' }),
      ],
      [debt({ id: 'd1', direction: 'receivable', amountOriginal: 100_000, amountPaid: 100_000, status: 'paid', isReversed: true })]
    );
    expect(ledger.global.deudasPorCobrarPendientes).toBe(0);
    expect(ledger.byAccount.bank.prestamosOtorgados).toBe(0);
    expect(ledger.byAccount.bank.saldoFisicoCalculado).toBe(100_000);
  });
});

describe('period reporting', () => {
  it('uses the same reportable rules as the accounting engine', () => {
    const start = new Date('2026-05-01T00:00:00');
    const end = new Date('2026-05-31T23:59:59');
    const report = buildFinancialSummaryForPeriod([
      tx({ id: 'income', type: 'income', amount: 100_000, date: new Date('2026-05-02') }),
      tx({ id: 'expense', type: 'expense', amount: 40_000, date: new Date('2026-05-03') }),
      tx({ id: 'transfer', type: 'expense', amount: 30_000, transferId: 'tr1', transferDirection: 'out', category: 'Transferencia entre cuentas', date: new Date('2026-05-04') }),
      tx({ id: 'loan', type: 'expense', amount: 20_000, debtId: 'd1', debtMovementKind: 'loan_principal_out', excludeFromReports: true, date: new Date('2026-05-05') }),
      tx({ id: 'historical', type: 'expense', amount: 10_000, excludeFromReports: true, date: new Date('2026-05-06') }),
    ], start, end, 'custom');

    expect(report.totalIncome).toBe(100_000);
    expect(report.totalExpenses).toBe(40_000);
    expect(report.balance).toBe(60_000);
  });

  it('monthly report excludes transfers, debts, reversals and historical movements', () => {
    const now = new Date();
    const transactions = [
      tx({ id: 'income', type: 'income', amount: 100_000, date: now }),
      tx({ id: 'expense', type: 'expense', amount: 40_000, date: now }),
      tx({ id: 'transfer', amount: 30_000, transferId: 'tr1', transferDirection: 'out', category: 'Transferencia entre cuentas', date: now }),
      tx({ id: 'debt', amount: 20_000, debtId: 'd1', debtMovementKind: 'loan_principal_out', excludeFromReports: true, date: now }),
      tx({ id: 'reversed', amount: 10_000, isReversed: true, date: now }),
    ];
    const report = buildMonthlyReport(transactions, []);
    expect(report.totalIncome).toBe(100_000);
    expect(report.totalExpenses).toBe(40_000);
    expect(report.balance).toBe(60_000);
  });

  it('Excel workbook matches accounting engine totals in cover sheet', () => {
    const accounts = [account({ initialBalance: 100_000 })];
    const transactions = [
      tx({ id: 'income', type: 'income', amount: 50_000 }),
      tx({ id: 'expense', type: 'expense', amount: 20_000 }),
      tx({ id: 'transfer', amount: 10_000, transferId: 'tr1', transferDirection: 'out', category: 'Transferencia entre cuentas' }),
      tx({ id: 'transfer-in', type: 'income', amount: 10_000, transferId: 'tr1', transferDirection: 'in', category: 'Transferencia entre cuentas' }),
    ];
    const ledger = buildAccountingLedger(accounts, transactions, []);
    const workbook = buildFinanceWorkbook({ accounts, transactions, debts: [] });
    const cover = workbook.getWorksheet('Portada');
    expect(cover?.getCell('B2').value).toBe(ledger.global.saldoFisicoCalculado);
    expect(cover?.getCell('B5').value).toBe(ledger.global.ingresosReportables);
    expect(cover?.getCell('B6').value).toBe(ledger.global.gastosReportablesOPresentes);
  });

  it('legacy Excel export is blocked without accounts so it cannot use old totals', async () => {
    await expect(exportTransactionsToExcel([tx()], 'x.xlsx')).rejects.toThrow(/legacy bloqueada/i);
  });
});
