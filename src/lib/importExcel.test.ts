import { describe, expect, it } from 'vitest';
import { parseAmount, parseSignedAmount, parseDate } from './importExcel';

describe('importExcel parseAmount', () => {
  it('interpreta correctamente pesos COP con punto o coma de miles', () => {
    expect(parseAmount('45.000')).toBe(45_000);
    expect(parseAmount('1.234.567')).toBe(1_234_567);
    expect(parseAmount('45000')).toBe(45_000);
    expect(parseAmount('$ 45.000')).toBe(45_000);
    expect(parseAmount(45000)).toBe(45_000);
  });

  it('ya no destruye valores con coma de miles (regresion del factor 1000x)', () => {
    // Antes: '45,000' => 45 y '1,250,000' => 1
    expect(parseAmount('45,000')).toBe(45_000);
    expect(parseAmount('1,250,000')).toBe(1_250_000);
  });

  it('respeta el signo en columnas de valor', () => {
    expect(parseSignedAmount('-45.000')).toBe(-45_000);
    expect(parseSignedAmount('(45.000)')).toBe(-45_000);
    expect(parseSignedAmount('45.000')).toBe(45_000);
  });
});

describe('importExcel parseDate', () => {
  it('interpreta dd/mm/aaaa como fecha local (no mm/dd estilo US)', () => {
    const d = parseDate('15/03/2026');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2); // marzo
    expect(d!.getDate()).toBe(15);
  });

  it('sin fecha (celda vacia) asume hoy de forma intencional', () => {
    expect(parseDate('')).toBeInstanceOf(Date);
  });

  it('una fecha con texto no reconocido devuelve null para marcar la fila (no la silencia a hoy)', () => {
    expect(parseDate('marzo tres')).toBeNull();
    expect(parseDate('no-es-fecha')).toBeNull();
  });
});
