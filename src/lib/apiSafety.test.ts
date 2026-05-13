import { describe, expect, it } from 'vitest';
import apiSource from '../../api/deepseek-chat.ts?raw';
import functionsSource from '../../functions/src/index.ts?raw';

describe('API and legacy function money safety', () => {
  it('does not parse user-written money with parseFloat in the Vercel chat API', () => {
    expect(apiSource).not.toMatch(/parseFloat|Number\.parseFloat/);
  });

  it('keeps the Firebase callable from acting as a financial write backdoor', () => {
    expect(functionsSource).not.toMatch(/parseFloat|Number\.parseFloat/);
    expect(functionsSource).toMatch(/ruta legacy de Firebase ya no registra movimientos financieros/i);
  });
});
