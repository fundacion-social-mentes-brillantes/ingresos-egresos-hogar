import { describe, expect, it } from 'vitest';
import { parseSafeCOP, parseSafeChatAmount } from './safeMoney';

describe('parseSafeCOP', () => {
  it('interprets plain pesos and Colombian thousands with dots', () => {
    expect(parseSafeCOP('45000')).toBe(45_000);
    expect(parseSafeCOP('45.000')).toBe(45_000);
    expect(parseSafeCOP('$45.000')).toBe(45_000);
    expect(parseSafeCOP('599.000')).toBe(599_000);
    expect(parseSafeCOP('2.912.319')).toBe(2_912_319);
  });

  it('rejects decimals, text, negatives and ambiguous formats', () => {
    expect(() => parseSafeCOP('45,50')).toThrow();
    expect(() => parseSafeCOP('abc')).toThrow();
    expect(() => parseSafeCOP('-45000')).toThrow();
    expect(() => parseSafeCOP('45.00')).toThrow();
    expect(() => parseSafeCOP('45,000.00')).toThrow();
  });
});

describe('parseSafeChatAmount', () => {
  it('extracts common chat COP values without floating point parsing', () => {
    expect(parseSafeChatAmount('45000')).toBe(45_000);
    expect(parseSafeChatAmount('45.000')).toBe(45_000);
    expect(parseSafeChatAmount('$45.000')).toBe(45_000);
    expect(parseSafeChatAmount('599.000')).toBe(599_000);
    expect(parseSafeChatAmount('2.912.319')).toBe(2_912_319);
    expect(parseSafeChatAmount('gaste 45 mil en mercado')).toBe(45_000);
  });

  it('escala mil/lucas/k y millones con el factor correcto (regresion del bug 1000x)', () => {
    expect(parseSafeChatAmount('45 mil')).toBe(45_000);
    expect(parseSafeChatAmount('3 lucas')).toBe(3_000);
    expect(parseSafeChatAmount('5k')).toBe(5_000);
    // El bug: "millones" entraba a la rama de "mil" (x1000) -> registraba 1000x menos.
    expect(parseSafeChatAmount('2 millones')).toBe(2_000_000);
    expect(parseSafeChatAmount('1 millon')).toBe(1_000_000);
    expect(parseSafeChatAmount('me prestaron 2 millones para el carro')).toBe(2_000_000);
  });

  it('rejects invalid, negative or ambiguous chat money', () => {
    expect(() => parseSafeChatAmount('45,50')).toThrow();
    expect(() => parseSafeChatAmount('abc')).toThrow();
    expect(() => parseSafeChatAmount('-45000')).toThrow();
  });
});
