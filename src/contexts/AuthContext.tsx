import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, callSeedDefaultUserData } from '../lib/firebase';
import { createUserProfile, getUserProfile } from '../lib/firestore';
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
          await firebaseUser.getIdToken(true);
          await callSeedDefaultUserData({});
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

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          await ensureUserProfile(firebaseUser);
        }
        setUser(firebaseUser);
      } catch (err) {
        console.error('Auth state handling error:', err);
        setUser(firebaseUser);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
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
      await cred.user.getIdToken(true);
      await callSeedDefaultUserData({});
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

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
