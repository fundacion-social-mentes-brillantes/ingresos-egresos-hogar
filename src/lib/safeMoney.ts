export function digitsToInteger(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error(`Valor de dinero invalido: ${digits}`);
  let total = 0;
  for (const char of digits) total = total * 10 + (char.charCodeAt(0) - 48);
  return total;
}

function hasValidThousandsGroups(value: string, separator: '.' | ','): boolean {
  const parts = value.split(separator);
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

export function parseSafeCOP(value: unknown): number {
  if (typeof value === 'number') {
    if (!globalThis.Number.isFinite(value) || !globalThis.Number.isInteger(value) || value < 0) throw new Error('Valor de dinero invalido.');
    return value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Escribe un valor de dinero.');
  if (/[-(]/.test(raw)) throw new Error('El dinero no puede ser negativo.');

  const cleaned = raw.replace(/cop/gi, '').replace(/\$/g, '').replace(/\s+/g, '').trim();
  if (!cleaned || !/^[0-9.,]+$/.test(cleaned)) throw new Error(`Valor de dinero invalido: ${raw}`);
  if (/^\d+$/.test(cleaned)) return digitsToInteger(cleaned);

  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;

  if (dotCount > 0 && commaCount > 0) throw new Error(`Valor de dinero ambiguo: ${raw}`);

  const separator = dotCount > 0 ? '.' : ',';
  if (!hasValidThousandsGroups(cleaned, separator)) throw new Error(`Valor de dinero ambiguo: ${raw}. Usa pesos completos, por ejemplo 45.000.`);
  return digitsToInteger(cleaned.replace(/[.,]/g, ''));
}

export function parseSafeChatAmount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return parseSafeCOP(value);
  const raw = String(value).trim();
  if (/[-(]/.test(raw)) throw new Error('El dinero no puede ser negativo.');
  try { return parseSafeCOP(raw); } catch {
    const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = text.match(/(?:\$\s*)?([0-9][0-9.,]*)\s*(mil|lucas?|k|millones?|millon)?\b/i);
    if (!match) throw new Error(`Valor de dinero invalido: ${raw}`);
    const base = parseSafeCOP(match[1]);
    const scale = match[2] || '';
    // OJO con el orden: 'millones'.startsWith('mil') === true, asi que la rama
    // de millones DEBE evaluarse primero o "2 millones" se registraria como 2.000
    // (error de factor 1000x). Por eso millon va antes que mil.
    if (scale.startsWith('millon')) return base * 1000000;
    if (scale.startsWith('mil') || scale.startsWith('luca') || scale === 'k') return base * 1000;
    return base;
  }
}
