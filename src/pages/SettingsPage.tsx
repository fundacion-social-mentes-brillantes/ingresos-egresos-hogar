import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useUserProfile } from '../hooks/useUserProfile';
import { useTransactions } from '../hooks/useTransactions';
import { addAccount, updateAccount, updateUserProfile } from '../lib/firestore';
import { isExternalAccount } from '../lib/accounting';
import { CATEGORIES, ACCOUNT_LABELS, type AccountType, formatCOP } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import { ProfileAvatar } from '../components/visual/ProfileAvatar';
import { VisualModeToggle } from '../components/ui/VisualModeToggle';
import {
  User,
  Wallet,
  Tag,
  Plus,
  ShieldCheck,
  Camera,
  X,
  Loader2,
  Palette,
} from 'lucide-react';

async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Selecciona una imagen valida.');
  if (file.size > 4 * 1024 * 1024) throw new Error('La imagen debe pesar menos de 4MB antes de comprimir.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No pude leer la imagen.'));
      image.src = objectUrl;
    });

    const maxSize = 420;
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);

    for (const quality of [0.82, 0.74, 0.66, 0.58]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= 220_000) return dataUrl;
    }
    throw new Error('La imagen sigue muy pesada. Prueba con una foto mas pequeña.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function SettingsPage() {
  const { user } = useAuth();
  const { displayName, email, photo, initials } = useUserProfile();
  const { accounts, refresh } = useTransactions();
  const [loading, setLoading] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newAcc, setNewAcc] = useState({ name: '', type: 'cash' as AccountType, balance: 0, ownership: 'own' as 'own' | 'external' });
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddAccount = async () => {
    if (!user || !newAcc.name) return;
    setLoading('add');
    try {
      await addAccount(user.uid, {
        name: newAcc.name,
        type: newAcc.type,
        initialBalance: newAcc.balance,
        currentBalance: newAcc.balance,
        active: true,
        ownership: newAcc.ownership,
      });
      setNewAcc({ name: '', type: 'cash', balance: 0, ownership: 'own' });
      setShowAdd(false);
      await refresh();
    } finally {
      setLoading(null);
    }
  };

  // Cambia una cuenta ya creada entre propia y ajena (Valeria guarda dinero que
  // no es de ella). El dinero ajeno deja de contar en sus finanzas personales.
  const handleSetOwnership = async (accountId: string, ownership: 'own' | 'external') => {
    if (!user) return;
    setLoading(`own-${accountId}`);
    try {
      await updateAccount(user.uid, accountId, { ownership });
      await refresh();
    } finally {
      setLoading(null);
    }
  };

  const handleProfileImage = async (file?: File) => {
    if (!user || !file) return;
    setPhotoSaving(true);
    setPhotoMessage(null);
    try {
      const dataUrl = await imageFileToDataUrl(file);
      await updateUserProfile(user.uid, { photoDataUrl: dataUrl, photoRemoved: false });
      setPhotoMessage('Foto actualizada.');
    } catch (error: any) {
      setPhotoMessage(error?.message || 'No pude actualizar la foto.');
    } finally {
      setPhotoSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    setPhotoSaving(true);
    setPhotoMessage(null);
    try {
      await updateUserProfile(user.uid, { photoDataUrl: null, photoURL: null, photoRemoved: true });
      setPhotoMessage('Foto quitada.');
    } catch (error: any) {
      setPhotoMessage(error?.message || 'No pude quitar la foto.');
    } finally {
      setPhotoSaving(false);
    }
  };

  return (
    <div className="space-y-7 pb-12">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lux-kicker">Preferencias del cockpit</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Configuracion</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Perfil, tema, cuentas, categorias y detalles visuales de la experiencia.</p>
          </div>
          <div className="premium-icon h-16 w-16 text-blue-200">
            <Palette className="h-8 w-8" />
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_0.86fr]">
        <Card className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <ProfileAvatar src={photo} initials={initials} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2 text-slate-300">
                <User className="h-5 w-5 text-blue-300" />
                <h2 className="font-black">Perfil</h2>
              </div>
              <p className="truncate text-2xl font-black text-slate-100">{displayName}</p>
              <p className="truncate text-sm text-slate-500">{email}</p>
              <p className="mt-3 inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-300">
                Moneda: COP
              </p>
              {photoMessage && <p className="mt-3 text-sm font-bold text-slate-400">{photoMessage}</p>}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleProfileImage(event.target.files?.[0])} />
            <Button type="button" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={photoSaving} icon={photoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}>
              Cambiar foto
            </Button>
            <Button type="button" variant="danger" onClick={handleRemovePhoto} disabled={photoSaving || !photo} icon={<X className="h-4 w-4" />}>
              Quitar
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            La foto se comprime a un JPEG pequeño antes de guardarse en tu perfil. Si luego conectas Firebase Storage, este punto puede migrarse a URL sin cambiar la UI.
          </p>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-slate-300">
            <ShieldCheck className="h-5 w-5 text-blue-300" />
            <h2 className="font-black">Tema visual</h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-500">Modo Hombre conserva el look actual. Modo Mujer activa una experiencia lilipink rosada, lila y suave sin guardar nada en Firebase.</p>
          <VisualModeToggle className="mt-5" />
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-300">
            <Wallet className="h-5 w-5 text-blue-300" />
            <h2 className="font-black">Cuentas</h2>
          </div>
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setShowAdd(!showAdd)}>
            Nueva
          </Button>
        </div>

        {showAdd && (
          <Card className="animate-fade-in border-blue-500/30 p-5">
            <h3 className="mb-4 text-sm font-black text-slate-100">Agregar nueva cuenta</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input label="Nombre" placeholder="Ej: Daviplata" value={newAcc.name} onChange={(event) => setNewAcc({ ...newAcc, name: event.target.value })} />
              <Select
                label="Tipo"
                options={[
                  { value: 'cash', label: 'Efectivo' },
                  { value: 'nequi', label: 'Nequi' },
                  { value: 'daviplata', label: 'Daviplata' },
                  { value: 'bank', label: 'Banco' },
                  { value: 'other', label: 'Otro' },
                ]}
                value={newAcc.type}
                onChange={(event) => setNewAcc({ ...newAcc, type: event.target.value as AccountType })}
              />
              <Input label="Saldo inicial" type="number" value={newAcc.balance} onChange={(event) => setNewAcc({ ...newAcc, balance: Number(event.target.value) })} />
            </div>
            <div className="mt-4">
              <Select
                label="¿De quién es el dinero?"
                options={[
                  { value: 'own', label: 'Propia (es mío)' },
                  { value: 'external', label: 'Ajena (guardo dinero de alguien más)' },
                ]}
                value={newAcc.ownership}
                onChange={(event) => setNewAcc({ ...newAcc, ownership: event.target.value as 'own' | 'external' })}
              />
              {newAcc.ownership === 'external' && <p className="mt-2 text-xs text-amber-300/90">Esta cuenta guarda dinero de terceros: no contará en tu saldo, ingresos ni gastos personales.</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" loading={loading === 'add'} onClick={handleAddAccount}>Guardar cuenta</Button>
            </div>
          </Card>
        )}

        {accounts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const ajena = isExternalAccount(account);
              const busyOwn = loading === `own-${account.id}`;
              return (
              <Card key={account.id} className="overflow-hidden p-5">
                <div className="flex items-start justify-between gap-4">
                  <AccountBrandMark type={account.type} name={account.name} size="lg" showLabel />
                  {ajena
                    ? <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">AJENA</span>
                    : <span className="rounded-full border border-green-400/20 bg-green-400/10 px-3 py-1 text-xs font-black text-green-300">PROPIA</span>}
                </div>
                <div className="mt-5 rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{ACCOUNT_LABELS[account.type]}</p>
                  <p className="mt-1 text-2xl font-black text-blue-200">{formatCOP(account.currentBalance)}</p>
                </div>
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">¿De quién es el dinero?</p>
                  <div className="flex items-center gap-1 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-1">
                    <button type="button" disabled={busyOwn} onClick={() => handleSetOwnership(account.id, 'own')} className={`flex-1 rounded-xl px-3 py-2 text-xs font-black transition ${!ajena ? 'bg-green-500/20 text-green-200' : 'text-slate-400 hover:text-slate-200'}`}>Propia</button>
                    <button type="button" disabled={busyOwn} onClick={() => handleSetOwnership(account.id, 'external')} className={`flex-1 rounded-xl px-3 py-2 text-xs font-black transition ${ajena ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400 hover:text-slate-200'}`}>{busyOwn ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Ajena'}</button>
                  </div>
                  {ajena && <p className="mt-2 text-[11px] leading-relaxed text-amber-300/90">Dinero de terceros: no cuenta en tu saldo ni en tus ingresos/gastos personales.</p>}
                </div>
              </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState asset="categories" title="No hay cuentas creadas" description="Crea cuentas como Efectivo, Nequi, Daviplata o Banco para ver sus marcas visuales." />
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-slate-300">
          <Tag className="h-5 w-5 text-blue-300" />
          <h2 className="font-black">Categorias</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <span key={category} className="rounded-2xl border border-slate-700/40 bg-slate-900/40 px-4 py-2 text-sm font-bold text-slate-300">
              {category}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
