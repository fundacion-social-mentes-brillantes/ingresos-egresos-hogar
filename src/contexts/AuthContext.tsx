import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, callSeedDefaultUserData } from '../lib/firebase';
import { createUserProfile, getUserProfile } from '../lib/firestore';
import {
  GoogleAuthProvider,
  signInWithPopup,
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
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
      await callSeedDefaultUserData({});
    } catch (e) {
      console.warn('Could not seed default data:', e);
    }
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const cred = await signInWithPopup(auth, provider);
    const firebaseUser = cred.user;

    const existingProfile = await getUserProfile(firebaseUser.uid);

    if (!existingProfile) {
      await createUserProfile(firebaseUser.uid, {
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuario',
        email: firebaseUser.email || '',
        defaultCurrency: 'COP',
      });

      try {
        await callSeedDefaultUserData({});
      } catch (e) {
        console.warn('Could not seed default data after Google sign-in:', e);
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
