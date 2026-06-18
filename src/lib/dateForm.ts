// Helpers puros para los campos de fecha/hora de los formularios de movimientos.
// Viven aparte para poder probarlos sin arrastrar Firebase ni React.

export const pad = (n: number): string => String(n).padStart(2, '0');

export const dateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const timeStr = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const todayStr = (): string => dateStr(new Date());

export const nowTimeStr = (): string => timeStr(new Date());

// Combina los inputs <date> y <time> en un Date local. Si algo es invalido,
// cae a "ahora" para no romper el guardado.
export const asDate = (date: string, time: string): Date => {
  const d = new Date(`${date || todayStr()}T${time || '12:00'}:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// Devuelve los strings de formulario que representan EXACTAMENTE la fecha dada.
// Es la pieza clave para que editar un movimiento conserve su fecha original
// en vez de moverlo al dia de hoy (y por tanto a otro mes contable).
export function formDateTimeFromDate(value: Date | null | undefined): { date: string; time: string } {
  const safe = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return { date: dateStr(safe), time: timeStr(safe) };
}
