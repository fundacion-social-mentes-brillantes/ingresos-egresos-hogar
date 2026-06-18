import { describe, expect, it } from 'vitest';
import { asDate, formDateTimeFromDate } from './dateForm';

describe('dateForm', () => {
  it('conserva la fecha/hora original del movimiento al editar', () => {
    const original = new Date(2026, 2, 15, 9, 30); // 15 de marzo de 2026, 09:30 local
    const { date, time } = formDateTimeFromDate(original);
    expect(date).toBe('2026-03-15');
    expect(time).toBe('09:30');
    const round = asDate(date, time);
    expect(round.getFullYear()).toBe(2026);
    expect(round.getMonth()).toBe(2);
    expect(round.getDate()).toBe(15);
  });

  it('no mueve un gasto de marzo al mes actual (regresion del reset a hoy)', () => {
    const marzo = new Date(2026, 2, 3, 12, 0);
    const { date } = formDateTimeFromDate(marzo);
    expect(date.startsWith('2026-03')).toBe(true);
  });

  it('cae a una fecha valida si el valor es invalido o nulo', () => {
    for (const value of [new Date('invalid'), null, undefined]) {
      const { date, time } = formDateTimeFromDate(value as Date | null | undefined);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
