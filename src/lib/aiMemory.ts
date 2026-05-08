import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { AiMemoryProfile } from '../types';

const defaultMemory: AiMemoryProfile = {
  preferredName: '',
  tonePreference: 'humano, claro, colombiano, directo y cálido',
  financialGoals: [],
  sensitiveCategories: [],
  knownIncomePattern: '',
  spendingPatterns: [],
  coachingNotes: [],
};

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeMemory(data: Record<string, any> | undefined): AiMemoryProfile {
  if (!data) return defaultMemory;
  return {
    preferredName: typeof data.preferredName === 'string' ? data.preferredName : '',
    tonePreference: typeof data.tonePreference === 'string' ? data.tonePreference : defaultMemory.tonePreference,
    financialGoals: Array.isArray(data.financialGoals) ? data.financialGoals.map(String).slice(0, 12) : [],
    sensitiveCategories: Array.isArray(data.sensitiveCategories) ? data.sensitiveCategories.map(String).slice(0, 12) : [],
    knownIncomePattern: typeof data.knownIncomePattern === 'string' ? data.knownIncomePattern : '',
    spendingPatterns: Array.isArray(data.spendingPatterns) ? data.spendingPatterns.map(String).slice(0, 20) : [],
    coachingNotes: Array.isArray(data.coachingNotes) ? data.coachingNotes.map(String).slice(0, 20) : [],
    lastUpdatedAt: toDate(data.lastUpdatedAt),
  };
}

function mergeUnique(current: string[] = [], incoming: string[] = [], limit = 20): string[] {
  const seen = new Set<string>();
  const merged = [...incoming, ...current]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return merged.slice(0, limit);
}

export async function getAiMemory(uid: string): Promise<AiMemoryProfile> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'aiMemory', 'profile'));
    return normalizeMemory(snap.exists() ? snap.data() : undefined);
  } catch (error) {
    // Memory is helpful, but the assistant must still work if rules are pending.
    console.debug('AI memory read skipped:', error);
    return defaultMemory;
  }
}

export async function updateAiMemory(uid: string, patch: Partial<AiMemoryProfile>) {
  try {
    const current = await getAiMemory(uid);
    const next: AiMemoryProfile = {
      ...current,
      ...patch,
      financialGoals: mergeUnique(current.financialGoals, patch.financialGoals, 12),
      sensitiveCategories: mergeUnique(current.sensitiveCategories, patch.sensitiveCategories, 12),
      spendingPatterns: mergeUnique(current.spendingPatterns, patch.spendingPatterns, 20),
      coachingNotes: mergeUnique(current.coachingNotes, patch.coachingNotes, 20),
    };

    await setDoc(
      doc(db, 'users', uid, 'aiMemory', 'profile'),
      {
        ...next,
        lastUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    // Do not throw. Missing aiMemory permissions must never block chat actions.
    console.debug('AI memory update skipped:', error);
  }
}

export function memoryToContext(memory: AiMemoryProfile): string {
  return [
    `Nombre preferido: ${memory.preferredName || 'no definido'}`,
    `Tono preferido: ${memory.tonePreference || 'humano, claro y cálido'}`,
    `Metas financieras: ${memory.financialGoals?.length ? memory.financialGoals.join('; ') : 'sin metas definidas'}`,
    `Categorías sensibles: ${memory.sensitiveCategories?.length ? memory.sensitiveCategories.join('; ') : 'sin categorías sensibles detectadas'}`,
    `Patrón de ingresos: ${memory.knownIncomePattern || 'no definido'}`,
    `Patrones de gasto: ${memory.spendingPatterns?.length ? memory.spendingPatterns.join('; ') : 'sin patrones suficientes'}`,
    `Notas de acompañamiento: ${memory.coachingNotes?.length ? memory.coachingNotes.join('; ') : 'sin notas'}`,
  ].join('\n');
}
