import { useState } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { deleteTransaction } from '../lib/firestore';
import { exportTransactionsToExcel } from '../lib/exportExcel';
import { useAuth } from '../contexts/AuthContext';
import { formatCOP } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Trash2, 
  Search,
  Bot,
  User,
  Loader2,
  Download
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import clsx from 'clsx';

export function TransactionsPage() {
  const { user } = useAuth();
  const { transactions, loading, refresh } = useTransactions();
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = transactions.filter(t => {
    const matchesType = filterType === 'all' || t.type === filterType;
    const matchesSearch = t.description.toLowerCase().includes(search.toLowerCase()) || 
                          t.category.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleDelete = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    try {
      await deleteTransaction(user.uid, id);
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = () => {
    const base = filterType === 'all' ? transactions : filtered;
    exportTransactionsToExcel(base, 'finanzas-organizadas-ingresos-egresos.xlsx');
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Movimientos</h1>
          <p className="text-slate-400 text-sm">Historial completo de tus finanzas</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Input 
            placeholder="Buscar..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="w-4 h-4" />}
            className="w-full md:w-64"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={transactions.length === 0}
            icon={<Download className="w-4 h-4" />}
          >
            Descargar Excel
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <Button 
          variant={filterType === 'all' ? 'primary' : 'ghost'} 
          size="sm" 
          onClick={() => setFilterType('all')}
        >
          Todos
        </Button>
        <Button 
          variant={filterType === 'income' ? 'success' : 'ghost'} 
          size="sm" 
          onClick={() => setFilterType('income')}
          icon={<ArrowUpRight className="w-4 h-4" />}
        >
          Ingresos
        </Button>
        <Button 
          variant={filterType === 'expense' ? 'danger' : 'ghost'} 
          size="sm" 
          onClick={() => setFilterType('expense')}
          icon={<ArrowDownLeft className="w-4 h-4" />}
        >
          Gastos
        </Button>
      </div>

      <div className="glass rounded-2xl overflow-hidden border border-slate-700/30">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/50 border-b border-slate-700/40">
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Fecha</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Descripción</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Categoría</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Cuenta</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Valor</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No se encontraron movimientos.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm text-slate-200">{format(t.date, 'dd MMM yyyy', { locale: es })}</span>
                        <span className="text-xs text-slate-500">{format(t.date, 'HH:mm')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {t.source === 'bot' ? (
                          <span title="Creado por bot">
                            <Bot className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          </span>
                        ) : (
                          <span title="Manual/importado">
                            <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          </span>
                        )}
                        <span className="text-sm text-slate-200 font-medium truncate max-w-[150px] md:max-w-xs">{t.description}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-700/50 text-slate-300 text-xs border border-slate-600/30">
                        {t.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                      {t.accountName}
                    </td>
                    <td className={clsx(
                      "px-6 py-4 whitespace-nowrap text-sm font-bold text-right",
                      t.type === 'income' ? 'text-green-400' : 'text-red-400'
                    )}>
                      {t.type === 'income' ? '+' : '-'}{formatCOP(t.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button 
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="p-2 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {deletingId === t.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
