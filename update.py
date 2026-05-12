import re

file_path = 'src/pages/AccountsPage.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# IMPORTS
imports_to_add = '''import { useAuth } from '../contexts/AuthContext';
import { transferBetweenAccounts } from '../lib/firestore';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { ArrowRightLeft, AlertCircle } from 'lucide-react';'''

content = content.replace('import { WalletCards, Bot, User, ReceiptText, AlertTriangle, CheckCircle2 } from \'lucide-react\';', 'import { WalletCards, Bot, User, ReceiptText, AlertTriangle, CheckCircle2, ArrowRightLeft, AlertCircle } from \'lucide-react\';\n' + imports_to_add)

# HOOKS & STATE
state_code = '''
  const { user } = useAuth();
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('Transferencia entre cuentas');

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setTransferError(null);
    setIsTransferring(true);
    
    try {
      const amountNum = Number(transferAmount.replace(/\\D/g, ''));
      if (amountNum <= 0) throw new Error('El monto debe ser mayor a cero');
      if (transferFrom === transferTo) throw new Error('Las cuentas de origen y destino deben ser distintas');
      
      const fromAcc = accounts.find(a => a.id === transferFrom);
      const toAcc = accounts.find(a => a.id === transferTo);
      if (!fromAcc || !toAcc) throw new Error('Cuentas no encontradas');
      
      await transferBetweenAccounts(
        user.uid,
        transferFrom,
        fromAcc.name,
        transferTo,
        toAcc.name,
        amountNum,
        transferDescription
      );
      
      setShowTransferForm(false);
      setTransferAmount('');
      setTransferFrom('');
      setTransferTo('');
      setTransferDescription('Transferencia entre cuentas');
    } catch (err: any) {
      setTransferError(err.message || 'Error al transferir');
    } finally {
      setIsTransferring(false);
    }
  };
'''

content = content.replace('const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);', 'const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);' + state_code)

# TRANSFER BUTTON
btn_code = '''<div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Tus Cuentas</h2>
              <Button 
                onClick={() => setShowTransferForm(!showTransferForm)}
                variant="primary"
                size="sm"
                className="gap-2"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {showTransferForm ? 'Cancelar' : 'Transferir'}
              </Button>
            </div>'''
content = content.replace('<h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Tus Cuentas</h2>', btn_code)

# TRANSFER FORM
form_code = '''
            {showTransferForm ? (
              <div className="p-6">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-slate-100">Transferir Dinero</h2>
                  <p className="mt-1 text-sm text-slate-400">Mueve dinero entre tus cuentas sin afectar los reportes de ingresos y gastos.</p>
                </div>
                
                <form onSubmit={handleTransfer} className="space-y-4">
                  {transferError && (
                    <div className="flex items-start gap-3 rounded-xl bg-red-500/10 p-4 border border-red-500/20 text-red-300">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <p className="text-sm">{transferError}</p>
                    </div>
                  )}
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Cuenta origen (Retiro)"
                      value={transferFrom}
                      onChange={(e) => setTransferFrom(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar cuenta</option>
                      {accounts.filter(a => a.active).map(a => (
                        <option key={`from-${a.id}`} value={a.id}>{a.name} ({formatCOP(a.currentBalance)})</option>
                      ))}
                    </Select>
                    
                    <Select
                      label="Cuenta destino (Ingreso)"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar cuenta</option>
                      {accounts.filter(a => a.active).map(a => (
                        <option key={`to-${a.id}`} value={a.id}>{a.name} ({formatCOP(a.currentBalance)})</option>
                      ))}
                    </Select>
                  </div>
                  
                  <Input
                    label="Monto a transferir"
                    type="text"
                    value={transferAmount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\\D/g, '');
                      setTransferAmount(value ? formatCOP(Number(value)) : '');
                    }}
                    placeholder="$ 0"
                    required
                  />
                  
                  <Input
                    label="Descripción (opcional)"
                    value={transferDescription}
                    onChange={(e) => setTransferDescription(e.target.value)}
                    placeholder="Ej: Pasar dinero a Nequi"
                  />
                  
                  <div className="pt-4 flex items-center gap-3 justify-end">
                    <Button type="button" variant="secondary" onClick={() => setShowTransferForm(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" variant="primary" disabled={isTransferring} className="gap-2">
                      <ArrowRightLeft className="h-4 w-4" />
                      {isTransferring ? 'Transfiriendo...' : 'Confirmar Transferencia'}
                    </Button>
                  </div>
                </form>
              </div>
            ) : selectedAccount ? (
'''

content = content.replace('{selectedAccount ? (', form_code)

# TAGS
tag_code = '''
                            {tx.excludeFromReports && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-300">
                                Histórico / No reportable
                              </span>
                            )}
                            {tx.transferId && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-300">
                                <ArrowRightLeft className="h-3 w-3" />
                                Transferencia
                              </span>
                            )}
'''

content = content.replace('''                            {tx.excludeFromReports && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-300">
                                Histórico
                              </span>
                            )}''', tag_code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
