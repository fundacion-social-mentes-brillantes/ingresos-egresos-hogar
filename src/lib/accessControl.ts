import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// Super-admin(s): siempre tienen acceso y son admin, identificados por su correo
// en el token de Firebase (no dependen de ningun documento). Es el ancla de
// confianza: solo ellos pueden empezar a aprobar/nombrar a los demas.
export const SUPER_ADMIN_EMAILS = ['fundacionsocial@gimnasioemocionalmb.com'];

export type AccessStatus = 'pending' | 'approved' | 'denied';
export type AccessRole = 'user' | 'admin';

export interface AccessRecord {
  uid: string;
  email: string;
  displayName?: string;
  status: AccessStatus;
  role: AccessRole;
  requestedAt?: Date;
  decidedAt?: Date;
  decidedBy?: string;
}

export function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return SUPER_ADMIN_EMAILS.includes(normalizeEmail(email));
}

const accessCol = () => collection(db, 'accessControl');
const accessRef = (uid: string) => doc(db, 'accessControl', uid);

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  return undefined;
}

function normalizeAccess(id: string, data: any): AccessRecord {
  return {
    uid: id,
    email: data.email || '',
    displayName: data.displayName || '',
    status: (data.status as AccessStatus) || 'pending',
    role: (data.role as AccessRole) || 'user',
    requestedAt: toDate(data.requestedAt),
    decidedAt: toDate(data.decidedAt),
    decidedBy: data.decidedBy || '',
  };
}

// Crea la solicitud PENDIENTE si aun no existe. Nunca pisa una decision previa.
// Las reglas solo permiten crear con status 'pending' y rol 'user' (nadie se
// auto-aprueba).
export async function ensureAccessRequest(uid: string, email: string, displayName: string) {
  const snap = await getDoc(accessRef(uid));
  if (snap.exists()) return;
  await setDoc(accessRef(uid), {
    email: normalizeEmail(email),
    displayName: displayName || '',
    status: 'pending',
    role: 'user',
    requestedAt: serverTimestamp(),
  });
}

// Escucha en tiempo real el propio acceso: si el admin aprueba, la pantalla del
// usuario pasa de "pendiente" a la app sola, sin recargar. onError se dispara si
// la lectura es DENEGADA (reglas aun sin desplegar) u offline; el llamador lo usa
// para no bloquear a nadie (los datos siguen aislados por cuenta).
export function watchMyAccess(
  uid: string,
  cb: (record: AccessRecord | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    accessRef(uid),
    (snap) => cb(snap.exists() ? normalizeAccess(snap.id, snap.data()) : null),
    (error) => { console.warn('watchMyAccess error', error); if (onError) onError(error); else cb(null); }
  );
}

export async function listAccess(): Promise<AccessRecord[]> {
  const snap = await getDocs(accessCol());
  return snap.docs.map((d) => normalizeAccess(d.id, d.data()));
}

// Todos los usuarios REGISTRADOS (perfil: solo nombre/correo/fecha). Las reglas
// permiten a un admin listar el perfil, pero NUNCA las subcolecciones con las
// finanzas de cada quien: eso sigue siendo privado del dueno.
export interface RegisteredUser {
  uid: string;
  email: string;
  displayName?: string;
  createdAt?: Date;
}

export async function listRegisteredUsers(): Promise<RegisteredUser[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      uid: d.id,
      email: normalizeEmail(data.email as string),
      displayName: (data.displayName as string) || '',
      createdAt: toDate(data.createdAt),
    };
  });
}

type ProfileHint = { email?: string; displayName?: string };

function profileFields(profile?: ProfileHint) {
  const fields: Record<string, unknown> = {};
  if (profile?.email) fields.email = normalizeEmail(profile.email);
  if (profile?.displayName) fields.displayName = profile.displayName;
  return fields;
}

// setDoc con merge (no updateDoc): asi el admin tambien puede decidir sobre
// alguien registrado que AUN no tiene doc de acceso (pre-aprobar/pre-denegar).
export async function decideAccess(uid: string, status: AccessStatus, deciderEmail: string, profile?: ProfileHint) {
  await setDoc(accessRef(uid), { ...profileFields(profile), status, decidedAt: serverTimestamp(), decidedBy: normalizeEmail(deciderEmail) }, { merge: true });
}

export async function setAccessRole(uid: string, role: AccessRole, deciderEmail: string, profile?: ProfileHint) {
  await setDoc(accessRef(uid), { ...profileFields(profile), role, decidedAt: serverTimestamp(), decidedBy: normalizeEmail(deciderEmail) }, { merge: true });
}
