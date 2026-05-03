import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { updateAccount, addAccount, updateSettings } from '../lib/firestore';
import { CATEGORIES, ACCOUNT_LABELS, type AccountType } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { 
  User, 
  Wallet, 
  Tag, 
  Settings as SettingsIcon,
  Plus,
  Check,
  Loader2,
  DollarSign
} from 'lucide-react';
import clsx from 'clsx';

export function SettingsPage() {
  const { user } = useAuth();
  const { accounts, refresh } = useTransactions();
  const [loading, setLoading] = useState<string | null>(null);
  
  // New account form
  const [showAdd, setShowAdd] = useState(false);
  const [newAcc, setNewAcc] = useState({ name: '', type: 'cash' as AccountType, balance: 0 });

  const handleAddAccount = async () => {
    if (!user || !newAcc.name) return;
    setLoading('add');
    try {
      await addAccount(user.uid, {
        name: newAcc.name,
        type: newAcc.type,
        initialBalance: newAcc.balance,
        currentBalance: newAcc.balance,
        active: true
      });
      setNewAcc({ name: '', type: 'cash', balance: 0 });
      setShowAdd(false);
      await refresh();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Configuración</h1>
        <p className="text-slate-400 text-sm">Personaliza tu experiencia financiera</p>
      </div>

      {/* Profile Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-slate-300 font-semibold">
          <User className="w-5 h-5 text-blue-400" />
          <h2>Perfil</h2>
        </div>
        <Card className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white shrink-0 shadow-lg">
            {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <p className="text-lg font-bold text-slate-100">{user?.displayName}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
            <p className="text-xs text-blue-400 mt-1 font-medium px-2 py-0.5 bg-blue-500/10 rounded-full inline-block border border-blue-500/20">
              Moneda: COP (Peso Colombiano)
            </p>
          </div>
        </Card>
      </section>

      {/* Accounts Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Wallet className="w-5 h-5 text-blue-400" />
            <h2>Cuentas</h2>
          </div>
          <Button 
            size="sm" 
            variant="ghost" 
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowAdd(!showAdd)}
          >
            Nueva
          </Button>
        </div>

        {showAdd && (
          <Card className="animate-fade-in border-blue-500/30">
            <h3 className="text-sm font-bold text-slate-200 mb-4">Agregar nueva cuenta</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Input 
                label="Nombre" 
                placeholder="Ej: Daviplata" 
                value={newAcc.name}
                onChange={e => setNewAcc({...newAcc, name: e.target.value})}
              />
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
                onChange={e => setNewAcc({...newAcc, type: e.target.value as AccountType})}
              />
              <Input 
                label="Saldo inicial" 
                type="number" 
                value={newAcc.balance}
                onChange={e => setNewAcc({...newAcc, balance: Number(e.target.value)})}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" loading={loading === 'add'} onClick={handleAddAccount}>Guardar cuenta</Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {accounts.map(acc => (
            <Card key={acc.id} className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700/50 text-blue-400">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-slate-100">{acc.name}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{ACCOUNT_LABELS[acc.type]}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-blue-400">ACTIVA</p>
                <p className="text-xs text-slate-500 mt-0.5">Saldo: No disp.</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Categories Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-slate-300 font-semibold">
          <Tag className="w-5 h-5 text-blue-400" />
          <h2>Categorías</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <span 
              key={cat}
              className="px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-sm text-slate-300"
            >
              {cat}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
