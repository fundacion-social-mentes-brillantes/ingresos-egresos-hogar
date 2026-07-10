import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { createUserProfile, ensureDefaultAccounts, getUserProfile } from '../lib/firestore';
import { ensureAccessRequest, isSuperAdminEmail, watchMyAccess, type AccessRecord } from '../lib/accessControl';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  browserLocalPersistence,
  setPersistence,
  type User,
} from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  access: AccessRecord | null;
  accessResolved: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeDisplayName(displayName: string, email: string): string {
  const cleanName = String(displayName || '').trim();
  if (cleanName) return cleanName;
  return normalizeEmail(email).split('@')[0] || 'Usuario';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess]   = useState<AccessRecord | null>(null);
  const [accessResolved, setAccessResolved] = useState(false);

  const ensureUserProfile = async (firebaseUser: User) => {
    try {
      await firebaseUser.getIdToken(true);
      const existingProfile = await getUserProfile(firebaseUser.uid);
      if (!existingProfile) {
        await createUserProfile(firebaseUser.uid, {
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuario',
          email: firebaseUser.email || '',
          defaultCurrency: 'COP',
        });

        try {
          await ensureDefaultAccounts(firebaseUser.uid);
        } catch (e) {
          console.warn('Could not seed default data:', e);
        }
      }
    } catch (err) {
      // La cuenta no debe quedarse bloqueada si falla la creación del perfil secundario.
      console.error('Error in ensureUserProfile:', err);
    }
  };

  useEffect(() => {
    const prepareAuth = async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (err) {
        console.warn('Could not set auth persistence:', err);
      }

      try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
          await ensureUserProfile(redirectResult.user);
        }
      } catch (err) {
        console.error('Redirect result error:', err);
      }
    };

    void prepareAuth();

    let accessUnsub: (() => void) | null = null;
    const stopAccess = () => { if (accessUnsub) { accessUnsub(); accessUnsub = null; } };

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      stopAccess();
      try {
        if (firebaseUser) {
          await ensureUserProfile(firebaseUser);
          // Resolver el ACCESO (porton de aprobacion). El super-admin entra por
          // correo sin depender de ningun documento. Los demas dependen de su
          // doc en accessControl (pendiente / aprobado / denegado).
          if (isSuperAdminEmail(firebaseUser.email)) {
            setAccess({ uid: firebaseUser.uid, email: firebaseUser.email || '', status: 'approved', role: 'admin' });
            setAccessResolved(true);
          } else {
            setAccessResolved(false);
            accessUnsub = watchMyAccess(
              firebaseUser.uid,
              (record) => {
                if (record) {
                  setAccess(record);
                  setAccessResolved(true);
                } else {
                  // Sin doc todavia: crea la solicitud pendiente (el listener
                  // volvera a disparar con el doc real) y muestra "pendiente".
                  setAccess({ uid: firebaseUser.uid, email: firebaseUser.email || '', status: 'pending', role: 'user' });
                  setAccessResolved(true);
                  void ensureAccessRequest(firebaseUser.uid, firebaseUser.email || '', firebaseUser.displayName || '').catch((e) => console.warn('No pude crear la solicitud de acceso', e));
                }
              },
              () => {
                // No se pudo evaluar el acceso (reglas de accessControl aun sin
                // desplegar, u offline): FAIL-OPEN para no bloquear a nadie ni
                // romper la app. Los datos siguen aislados por cuenta (isOwner);
                // el porton se activa en cuanto las reglas nuevas esten publicadas.
                setAccess({ uid: firebaseUser.uid, email: firebaseUser.email || '', status: 'approved', role: 'user' });
                setAccessResolved(true);
              },
            );
          }
        } else {
          setAccess(null);
          setAccessResolved(true);
        }
        setUser(firebaseUser);
      } catch (err) {
        console.error('Auth state handling error:', err);
        setUser(firebaseUser);
        setAccessResolved(true);
      } finally {
        setLoading(false);
      }
    });
    return () => { stopAccess(); unsub(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeDisplayName(displayName, normalizedEmail);

    await setPersistence(auth, browserLocalPersistence);
    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

    try {
      await updateProfile(cred.user, { displayName: normalizedName });
    } catch (e) {
      console.warn('Could not update user display name:', e);
    }

    try {
      await cred.user.getIdToken(true);
    } catch (e) {
      console.warn('Could not refresh token after sign up:', e);
    }

    try {
      await createUserProfile(cred.user.uid, {
        displayName: normalizedName,
        email: normalizedEmail,
        defaultCurrency: 'COP',
      });
    } catch (e) {
      console.warn('Could not create user profile after sign up:', e);
    }

    try {
      await ensureDefaultAccounts(cred.user.uid);
    } catch (e) {
      console.warn('Could not seed default data after sign up:', e);
    }
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ 
      prompt: 'select_account',
      display: 'popup'
    });

    await setPersistence(auth, browserLocalPersistence);

    try {
      await signInWithPopup(auth, provider);
      // Profile creation handled by onAuthStateChanged.
    } catch (err: any) {
      // If popup is blocked or closed, fallback to redirect.
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        console.log('Popup blocked or cancelled, trying redirect...');
        await signInWithRedirect(auth, provider);
      } else {
        throw err;
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const superAdmin = isSuperAdminEmail(user?.email);
  const isApproved = superAdmin || access?.status === 'approved';
  const isAdmin = superAdmin || (access?.role === 'admin' && access?.status === 'approved');

  return (
    <AuthContext.Provider value={{ user, loading, access, accessResolved, isSuperAdmin: superAdmin, isAdmin, isApproved, signIn, signUp, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
