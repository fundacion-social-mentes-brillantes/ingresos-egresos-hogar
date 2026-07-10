import { describe, expect, it } from 'vitest';
import type { Account, Debt, Transaction } from '../types';
import {
  buildAccountingLedger,
  buildFinancialSummaryForPeriod,
  calculateReconciliation,
  genericReversalBlockReason,
  inferMovementKind,
  isExternalAccount,
  isReportableFinancialTransaction,
  parseCurrencyInput,
  personalTransactions,
} from './accounting';
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
    expect(() => parseCurrencyInput('45,000.00')).toThrow();
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
      [account({ initialBalance: 4_200_319, realBalance: 3_551_319 })],
      [
        tx({ id: 'hist', amount: 599_000, excludeFromReports: true, category: 'Abono / Descuento' }),
        tx({ id: 'g1', amount: 25_000, category: 'Alimentacion' }),
        tx({ id: 'g2', amount: 20_000, category: 'Transporte' }),
      ]
    );
    expect(ledger.byAccount.bank.gastosReportablesOPresentes).toBe(45_000);
    expect(ledger.byAccount.bank.gastosHistoricosNoReportables).toBe(599_000);
    expect(ledger.byAccount.bank.salidasFisicasTotales).toBe(644_000);
    expect(ledger.byAccount.bank.saldoFisicoCalculado).toBe(3_556_319);
    expect(ledger.byAccount.bank.saldoRealIngresado).toBe(3_551_319);
    expect(ledger.byAccount.bank.estado).toBe('descuadre');
    expect(ledger.byAccount.bank.diferenciaConciliacion).toBe(-5_000);
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

describe('atribucion de movimientos por cuenta', () => {
  it('usa accountId y no duplica el movimiento en cuentas con el mismo nombre', () => {
    const accounts = [
      account({ id: 'a1', name: 'Banco', initialBalance: 100_000, currentBalance: 100_000 }),
      account({ id: 'a2', name: 'Banco', type: 'cash', initialBalance: 0, currentBalance: 0 }),
    ];
    const transactions = [tx({ id: 'g1', type: 'expense', amount: 30_000, accountId: 'a1', accountName: 'Banco' })];
    const ledger = buildAccountingLedger(accounts, transactions);
    expect(ledger.byAccount.a1.salidasFisicasTotales).toBe(30_000);
    expect(ledger.byAccount.a2.salidasFisicasTotales).toBe(0);
    // Antes (match por nombre) se contaba en ambas cuentas y el global se duplicaba.
    expect(ledger.global.salidasFisicasTotales).toBe(30_000);
  });

  it('cae al nombre solo cuando el movimiento legacy no trae accountId', () => {
    const accounts = [account({ id: 'a1', name: 'Efectivo', initialBalance: 0, currentBalance: 0 })];
    const legacy = tx({ id: 'old', type: 'expense', amount: 5_000, accountName: 'Efectivo' });
    delete (legacy as Partial<Transaction>).accountId;
    const ledger = buildAccountingLedger(accounts, [legacy]);
    expect(ledger.byAccount.a1.salidasFisicasTotales).toBe(5_000);
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

  it('Excel transaction rows use accounting cash effect for reversals', () => {
    const accounts = [account({ initialBalance: 100_000 })];
    const transactions = [
      tx({ id: 'reversed-original', type: 'expense', amount: 20_000, isReversed: true }),
      tx({ id: 'reversal-row', type: 'income', amount: 20_000, reversalOf: 'reversed-original', excludeFromReports: true, movementKind: 'reconciliation_adjustment' }),
      tx({ id: 'active', type: 'expense', amount: 10_000 }),
    ];
    const workbook = buildFinanceWorkbook({ accounts, transactions, debts: [] });
    const sheet = workbook.getWorksheet('Movimientos');
    // "Efecto caja" es la col 10 (tras insertar la col 8 "Titular" propia/ajena).
    expect(sheet?.getRow(2).getCell(10).value).toBe(0);
    expect(sheet?.getRow(3).getCell(10).value).toBe(0);
    expect(sheet?.getRow(4).getCell(10).value).toBe(-10_000);
  });

  it('legacy Excel export is blocked without accounts so it cannot use old totals', async () => {
    await expect(exportTransactionsToExcel([tx()], 'x.xlsx')).rejects.toThrow(/legacy bloqueada/i);
  });

  it('el Excel cuadra: portada declara el dinero ajeno y las hojas marcan Titular', () => {
    const accounts = [
      account({ id: 'mia', name: 'Banco', currentBalance: 300_000, initialBalance: 300_000 }),
      account({ id: 'camionetas', name: 'Camionetas', type: 'other', ownership: 'external', currentBalance: 5_000_000, initialBalance: 5_000_000 }),
    ];
    const transactions = [
      tx({ id: 'mio', type: 'expense', amount: 40_000, accountId: 'mia', accountName: 'Banco' }),
      tx({ id: 'ajeno', type: 'expense', amount: 1_000_000, accountId: 'camionetas', accountName: 'Camionetas' }),
    ];
    const ledger = buildAccountingLedger(accounts, transactions, []);
    const workbook = buildFinanceWorkbook({ accounts, transactions, debts: [] });
    // La portada declara el dinero ajeno = valorTotalAjeno (fila de conciliacion).
    const cover = workbook.getWorksheet('Portada');
    const ajenoRow = cover?.getRow(11);
    expect(String(ajenoRow?.getCell(1).value)).toMatch(/ajeno/i);
    expect(ajenoRow?.getCell(2).value).toBe(ledger.global.valorTotalAjeno);
    expect(ledger.global.valorTotalAjeno).toBe(5_000_000);
    // La hoja Cuentas marca Titular (col 2) Propia/Ajena.
    const cuentas = workbook.getWorksheet('Cuentas');
    expect(cuentas?.getRow(2).getCell(2).value).toBe('Propia');
    expect(cuentas?.getRow(3).getCell(2).value).toBe('Ajena');
    // La hoja Movimientos marca Titular (col 8) por movimiento.
    const movs = workbook.getWorksheet('Movimientos');
    expect(movs?.getRow(2).getCell(8).value).toBe('Propia');
    expect(movs?.getRow(3).getCell(8).value).toBe('Ajena');
  });
});

describe('cuentas ajenas (dinero de terceros)', () => {
  const propia = account({ id: 'mia', name: 'Banco', currentBalance: 300_000, initialBalance: 300_000 });
  const ajena = account({ id: 'camionetas', name: 'Cuentas camionetas', type: 'other', ownership: 'external', currentBalance: 5_000_000, initialBalance: 5_000_000 });

  it('isExternalAccount solo es true con ownership external (undefined = propia)', () => {
    expect(isExternalAccount(ajena)).toBe(true);
    expect(isExternalAccount(propia)).toBe(false);
    expect(isExternalAccount(account({ ownership: 'own' }))).toBe(false);
    expect(isExternalAccount(account())).toBe(false); // sin campo = propia
  });

  it('personalTransactions excluye movimientos de cuentas ajenas por accountId', () => {
    const txs = [
      tx({ id: 'mio', accountId: 'mia', accountName: 'Banco', amount: 10_000 }),
      tx({ id: 'ajeno', accountId: 'camionetas', accountName: 'Cuentas camionetas', amount: 999_999 }),
    ];
    const personal = personalTransactions(txs, [propia, ajena]);
    expect(personal.map((t) => t.id)).toEqual(['mio']);
  });

  it('personalTransactions excluye legacy (sin accountId) por nombre de cuenta ajena', () => {
    const legacy = tx({ id: 'legacy-ajeno', accountName: 'Cuentas camionetas', amount: 7_000 });
    delete (legacy as Partial<Transaction>).accountId;
    const personal = personalTransactions([legacy], [propia, ajena]);
    expect(personal).toHaveLength(0);
  });

  it('un movimiento con accountId propio NO se excluye aunque comparta nombre con una ajena', () => {
    const homonima = account({ id: 'camionetas', name: 'Banco', ownership: 'external', currentBalance: 0, initialBalance: 0 });
    const mio = tx({ id: 'mio', accountId: 'mia', accountName: 'Banco', amount: 10_000 });
    const personal = personalTransactions([mio], [propia, homonima]);
    expect(personal.map((t) => t.id)).toEqual(['mio']); // manda el accountId, no el nombre
  });

  it('sin cuentas ajenas devuelve el MISMO arreglo (sin costo)', () => {
    const txs = [tx({ id: 'a' }), tx({ id: 'b' })];
    expect(personalTransactions(txs, [propia])).toBe(txs);
  });

  it('el ledger separa liquido propio de dinero ajeno y no mezcla totales', () => {
    const transactions = [
      tx({ id: 'gasto-mio', type: 'expense', amount: 40_000, accountId: 'mia', accountName: 'Banco', date: new Date('2026-05-03') }),
      tx({ id: 'gasto-ajeno', type: 'expense', amount: 1_000_000, accountId: 'camionetas', accountName: 'Cuentas camionetas', date: new Date('2026-05-04') }),
    ];
    const ledger = buildAccountingLedger([propia, ajena], transactions, []);
    // Liquido personal = solo la cuenta propia; ajeno reportado aparte.
    expect(ledger.global.valorTotalLiquido).toBe(300_000);
    expect(ledger.global.valorTotalAjeno).toBe(5_000_000);
    expect(ledger.global.cuentasActivas).toBe(1); // solo cuentas propias activas
    expect(ledger.global.cuentasAjenas).toBe(1);
    // El gasto de la cuenta ajena NO entra en los gastos globales personales.
    expect(ledger.global.gastosReportablesOPresentes).toBe(40_000);
    // byAccount conserva la cuenta ajena para su auditoria/conciliacion.
    expect(ledger.byAccount.camionetas.salidasFisicasTotales).toBe(1_000_000);
  });

  it('el resumen del periodo sobre movimientos propios ignora el gasto ajeno', () => {
    const start = new Date('2026-05-01T00:00:00');
    const end = new Date('2026-05-31T23:59:59');
    const transactions = [
      tx({ id: 'gasto-mio', type: 'expense', amount: 40_000, accountId: 'mia', accountName: 'Banco', date: new Date('2026-05-03') }),
      tx({ id: 'gasto-ajeno', type: 'expense', amount: 1_000_000, accountId: 'camionetas', accountName: 'Cuentas camionetas', date: new Date('2026-05-04') }),
    ];
    const summary = buildFinancialSummaryForPeriod(personalTransactions(transactions, [propia, ajena]), start, end, 'this_month');
    expect(summary.totalExpenses).toBe(40_000);
  });
});
