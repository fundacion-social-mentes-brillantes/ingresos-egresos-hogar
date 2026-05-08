import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import type { UserProfile } from '../types';

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
}

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name || email || 'Usuario').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    return onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setProfile(null);
          return;
        }
        const data = snapshot.data();
        setProfile({ ...data, uid: user.uid, createdAt: toDate(data.createdAt) } as UserProfile);
      },
      () => setProfile(null)
    );
  }, [user]);

  return useMemo(() => {
    const displayName = profile?.displayName || user?.displayName || 'Usuario';
    const email = profile?.email || user?.email || '';
    const photo = profile?.photoRemoved ? null : profile?.photoDataUrl || profile?.photoURL || user?.photoURL || null;
    return {
      profile,
      displayName,
      email,
      photo,
      initials: initialsFrom(displayName, email),
    };
  }, [profile, user]);
}
