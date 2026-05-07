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
      console.error('Error in ensureUserProfile:', err);
    }
  };

  useEffect(() => {
    // Handle redirect result if any
    getRedirectResult(auth).catch((err) => {
      console.error('Redirect result error:', err);
    });

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
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    // Create Firestore profile
    await createUserProfile(cred.user.uid, {
      displayName,
      email,
      defaultCurrency: 'COP',
    });
    // Seed default accounts and categories
    try {
      await cred.user.getIdToken(true);
      await callSeedDefaultUserData({});
    } catch (e) {
      console.warn('Could not seed default data:', e);
    }
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ 
      prompt: 'select_account',
      // Useful for cross-domain auth issues
      display: 'popup'
    });

    try {
      await signInWithPopup(auth, provider);
      // Profile creation handled by onAuthStateChanged
    } catch (err: any) {
      // If popup is blocked, fallback to redirect
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
