import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { auth, db } from '../lib/firebase';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  addAccount,
  addChatMessage,
  addTransaction,
  deleteTransaction,
  getAccounts,
  getTransactions,
  getTransactionsByRange,
} from '../lib/firestore';
import type { Account, ChatMessage, FinancialSummary, Transaction, TransactionType } from '../types';
import { DEFAULT_ACCOUNTS, formatCOP } from '../types';
import {
  AlertCircle,
  Bot,
  Camera,
  CheckCircle2,
  Loader2,
  PieChart,
  RefreshCw,
  Send,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

interface ChatPageProps {
  embedded?: boolean;
}

interface ChatErrorState {
  friendly: string;
  code?: string;
  message?: string;
  details?: string;
}

interface VercelBotAction {
  intent: string;
  replyToUser: string;
  shouldCreateTransaction?: boolean;
  transaction?: {
    type?: TransactionType;
    amount?: number | string;
    currency?: string;
    category?: string;
    accountName?: string;
    description?: string;
    date?: string;
  };
  query?: {
    range?: 'today' | 'last_3_days' | 'last_7_days' | 'this_month' | 'custom';
    metric?: string;
    category?: string;
  };
  deleteTarget?: {
    scope?: 'last' | 'last_income' | 'last_expense' | 'amount_match';
    type?: TransactionType | null;
    amount?: number | string | null;
    descriptionHint?: string;
  };
  confidence?: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
}

function formatErrorDetails(details: unknown): string | undefined {
  if (!details) return undefined;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function getFriendlyChatError(error: any): ChatErrorState {
  const code = error?.code || 'desconocido';
  const message = error?.message ? String(error.message) : undefined;
  const details = formatErrorDetails(error?.details);

  if (code === 'deepseek/vercel-api') {
    return {
      friendly: 'DeepSeek V4 Pro no respondió desde Vercel. Revisa el detalle técnico abajo.',
      code,
      message,
      details,
    };
  }

  if (code === 'functions/unauthenticated') {
    return {
      friendly: 'Tu sesión se venció. Cierra sesión y vuelve a entrar con Google.',
      code,
      message,
      details,
    };
  }

  return {
    friendly: `No pude procesar el mensaje. Código: ${code}`,
    code,
    message,
    details,
  };
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeAmount(value: string): number {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  const match = text.match(/(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*(mil|lucas?|k|millones?|millon)?/i);
  if (!match) return 0;

  const base = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(base)) return 0;

  const scale = match[2] || '';
  if (scale.startsWith('mil') || scale.startsWith('luca') || scale === 'k') return base * 1000;
  if (scale.startsWith('millon')) return base * 1000000;
  return base;
}

function inferTransactionType(message: string): TransactionType | null {
  const text = normalizeText(message);
  const incomeWords = [
    'me entro', 'entro plata', 'entraron', 'recibi', 'recibo', 'me pagaron', 'cobre', 'cobro',
    'me consignaron', 'me depositaron', 'vendi', 'venta', 'ingrese', 'ingresa', 'ingreso',
    'ingresos', 'tengo en ingresos', 'agrega ingreso', 'registrar ingreso', 'sueldo', 'salario', 'quincena',
  ];
  const expenseWords = [
    'me gaste', 'gaste', 'gasto', 'gastos', 'egreso', 'egresos', 'compre', 'compra', 'pague',
    'almorce', 'recargue', 'tanquie', 'me toco pagar',
  ];

  if (incomeWords.some((word) => text.includes(word))) return 'income';
  if (expenseWords.some((word) => text.includes(word))) return 'expense';
  return null;
}

function inferDescription(message: string): string {
  const description = message
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '')
    .replace(/\b(me gaste|gast[eé]|gasto|gastos|egreso|egresos|compre|compr[eé]|pague|pagu[eé]|me pagaron|recibi|recib[ií]|recibo|cobre|cobr[eé]|ingresa|ingrese|ingreso|ingresos|entra|entr[oó]|entraron|agrega|registrar|tengo|en|por|con|de)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return description || 'Movimiento registrado desde el chat';
}

function inferCategory(message: string, type: TransactionType): string {
  if (type === 'income') return 'Ingreso';

  const text = normalizeText(message);
  if (['helado', 'comida', 'mercado', 'cafe', 'almuerzo', 'restaurante', 'tienda'].some((word) => text.includes(word))) return 'Alimentación';
  if (['bus', 'taxi', 'uber', 'gasolina', 'transporte', 'pasaje'].some((word) => text.includes(word))) return 'Transporte';
  if (['arriendo', 'luz', 'agua', 'gas', 'internet', 'hogar'].some((word) => text.includes(word))) return 'Hogar';
  if (['medicina', 'farmacia', 'salud', 'doctor'].some((word) => text.includes(word))) return 'Salud';
  return 'Otros';
}

async function ensureLocalAccounts(uid: string): Promise<Account[]> {
  const existing = await getAccounts(uid);
  if (existing.length > 0) return existing;

  await Promise.all(
    DEFAULT_ACCOUNTS.map((account) =>
      addAccount(uid, {
        ...account,
        initialBalance: 0,
        currentBalance: 0,
        active: true,
      })
    )
  );

  return getAccounts(uid);
}

function buildSummary(transactions: Awaited<ReturnType<typeof getTransactionsByRange>>): FinancialSummary {
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses = transactions.filter((t) => t.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const byCategory = transactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, tx) => {
      acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
      return acc;
    }, {} as Record<string, number>);

  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    byCategory,
    range: 'this_month',
    generatedAt: new Date(),
  };
}

async function getLocalMonthlySummary(uid: string): Promise<FinancialSummary> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const transactions = await getTransactionsByRange(uid, start, end);
  return buildSummary(transactions);
}

function botAmountToNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return normalizeAmount(String(value));
}

function botDateToDate(value?: string): Date {
  if (!value || value === 'today') return new Date();
  if (value === 'yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildVercelContext(accounts: Account[], summary: FinancialSummary, recentTransactions: Transaction[]): string {
  const recent = recentTransactions.slice(0, 10).map((tx, index) => (
    `${index + 1}. ${tx.type === 'income' ? 'ingreso' : 'gasto'} ${formatCOP(tx.amount)} | ${tx.category} | ${tx.description} | cuenta ${tx.accountName}`
  ));

  return [
    `Cuentas disponibles: ${accounts.map((account) => `${account.name} (${formatCOP(account.currentBalance || 0)})`).join(', ') || 'sin cuentas'}`,
    `Resumen del mes: ingresos ${formatCOP(summary.totalIncome)}, gastos ${formatCOP(summary.totalExpenses)}, balance ${formatCOP(summary.balance)}`,
    `Movimientos recientes para consultar, razonar o borrar:\n${recent.length ? recent.join('\n') : 'sin movimientos recientes'}`,
  ].join('\n\n');
}

async function callVercelDeepSeek(actionPayload: Record<string, unknown>): Promise<VercelBotAction> {
  const response = await fetch('/api/deepseek-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(actionPayload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details || data?.error || `HTTP ${response.status}`;
    const error: any = new Error(String(detail));
    error.code = 'deepseek/vercel-api';
    error.details = data;
    throw error;
  }

  if (!data?.action?.replyToUser) {
    const error: any = new Error('DeepSeek V4 Pro no devolvió una acción válida.');
    error.code = 'deepseek/vercel-api';
    error.details = data;
    throw error;
  }

  return data.action as VercelBotAction;
}

function looksLikeDeleteRequest(message: string): boolean {
  const text = normalizeText(message);
  return ['borra', 'borrar', 'elimina', 'eliminar', 'quita', 'quitar', 'deshaz', 'deshacer', 'anula', 'anular'].some((word) => text.includes(word));
}

async function findTransactionToDelete(uid: string, botAction: VercelBotAction, message: string): Promise<Transaction | null> {
  const transactions = await getTransactions(uid, 50);
  if (transactions.length === 0) return null;

  const target = botAction.deleteTarget || {};
  const amountFromMessage = normalizeAmount(message);
  const requestedAmount = target.amount ? botAmountToNumber(target.amount) : amountFromMessage;
  const requestedType = target.type || inferTransactionType(message);
  const scope = target.scope || (requestedType === 'income' ? 'last_income' : requestedType === 'expense' ? 'last_expense' : 'last');

  if (scope === 'last_income') return transactions.find((tx) => tx.type === 'income') || null;
  if (scope === 'last_expense') return transactions.find((tx) => tx.type === 'expense') || null;

  if (scope === 'amount_match' || requestedAmount > 0) {
    return transactions.find((tx) => {
      const sameAmount = Math.abs(Number(tx.amount || 0) - requestedAmount) < 1;
      const sameType = requestedType ? tx.type === requestedType : true;
      return sameAmount && sameType;
    }) || null;
  }

  return transactions[0] || null;
}

async function runVercelDeepSeekChat(
  uid: string,
  message: string,
  imageData: { base64: string; mime: string } | null,
  currentMessages: ChatMessage[]
) {
  await addChatMessage(uid, { text: message, sender: 'user' });

  const accounts = await ensureLocalAccounts(uid);
  const currentSummary = await getLocalMonthlySummary(uid);
  const recentTransactions = await getTransactions(uid, 20);
  const context = buildVercelContext(accounts, currentSummary, recentTransactions);

  const botAction = await callVercelDeepSeek({
    message,
    imageBase64: imageData?.base64,
    imageMimeType: imageData?.mime,
    context,
    chatHistory: currentMessages.slice(-20),
  });

  let replyToUser = botAction.replyToUser;
  let transactionId: string | undefined;
  let summary: FinancialSummary | undefined;
  const suggestedNextQuestion = botAction.suggestedNextQuestion || '';

  if (botAction.intent === 'create_transaction' && botAction.transaction && (botAction.confidence ?? 0) >= 0.65) {
    const tx = botAction.transaction;
    const amount = botAmountToNumber(tx.amount);
    const type = tx.type || inferTransactionType(message);
    const account = accounts.find((item) => normalizeText(item.name) === normalizeText(tx.accountName || ''))
      || accounts.find((item) => normalizeText(item.name) === 'efectivo')
      || accounts[0];

    if (!type || !amount || amount <= 0 || !account) {
      replyToUser = 'Entendí la intención, pero falta un dato para guardarlo bien. Dime si es ingreso o gasto y el valor exacto.';
    } else {
      const created = await addTransaction(uid, {
        type,
        amount,
        currency: 'COP',
        category: tx.category || inferCategory(message, type),
        accountId: account.id,
        accountName: account.name,
        description: tx.description || inferDescription(message),
        date: botDateToDate(tx.date),
        rawText: message,
        source: 'bot',
        confidence: botAction.confidence ?? 0.95,
      });
      transactionId = created.id;
      summary = await getLocalMonthlySummary(uid);
    }
  }

  if (botAction.intent === 'delete_transaction' || looksLikeDeleteRequest(message)) {
    const txToDelete = await findTransactionToDelete(uid, botAction, message);

    if (!txToDelete) {
      replyToUser = 'No encontré un movimiento reciente para borrar. Dime el valor exacto o ve a Movimientos y lo eliminas con el ícono de basura.';
      transactionId = undefined;
    } else {
      await deleteTransaction(uid, txToDelete.id);
      summary = await getLocalMonthlySummary(uid);
      const label = txToDelete.type === 'income' ? 'ingreso' : 'gasto';
      replyToUser = `Listo, borré el ${label} de ${formatCOP(txToDelete.amount)} (${txToDelete.description}). El dashboard ya debe actualizarse con el nuevo balance.`;
      transactionId = undefined;
    }
  }

  if (botAction.intent === 'query_summary') {
    summary = await getLocalMonthlySummary(uid);
    replyToUser = `Te leo los datos reales: este mes llevas ${formatCOP(summary.totalIncome)} en ingresos y ${formatCOP(summary.totalExpenses)} en gastos. Tu balance neto va en ${formatCOP(summary.balance)}. ${summary.balance >= 0 ? 'Vas con margen; la jugada inteligente es separar ahorro antes de seguir gastando.' : 'Estás en negativo; la prioridad es cortar fugas pequeñas y revisar gastos variables hoy mismo.'}`;
  }

  await addChatMessage(uid, {
    text: replyToUser,
    sender: 'bot',
    emotionalTone: botAction.emotionalTone || 'encouraging',
    suggestedNextQuestion,
    transactionId,
    summary,
    intent: botAction.intent,
  } as any);
}

export function ChatPage({ embedded = false }: ChatPageProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chatError, setChatError] = useState<ChatErrorState | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, `users/${user.uid}/chatMessages`), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ChatMessage)).reverse();
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setChatError({ friendly: 'Por favor selecciona una imagen válida.', code: 'imagen-invalida' });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setChatError({ friendly: 'La imagen es demasiado grande. Intenta con una de menos de 8MB.', code: 'imagen-pesada' });
      return;
    }

    setChatError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1280;

        if (width > height && width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        } else if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        setSelectedImage({ base64: compressedBase64.split(',')[1], mime: 'image/jpeg', preview: compressedBase64 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSend = async (text: string = input) => {
    const messageText = text.trim();
    if (!messageText && !selectedImage) return;
    if (loading) return;
    if (!user || !auth.currentUser) {
      setChatError({ friendly: 'Tu sesión no está activa. Cierra sesión y vuelve a entrar.', code: 'functions/unauthenticated' });
      return;
    }

    const finalMessage = messageText || 'Analiza esta imagen y dime si hay un gasto o ingreso para registrar.';
    setInput('');
    const imageData = selectedImage;
    setSelectedImage(null);
    setLoading(true);
    setIsTyping(true);
    setChatError(null);

    try {
      await auth.currentUser.getIdToken(true);
      await runVercelDeepSeekChat(
        user.uid,
        finalMessage,
        imageData ? { base64: imageData.base64, mime: imageData.mime } : null,
        messages
      );
    } catch (error: any) {
      console.error('Chat error full:', { code: error?.code, message: error?.message, details: error?.details, raw: error });
      setChatError(getFriendlyChatError(error));
    } finally {
      setLoading(false);
      setIsTyping(false);
    }
  };

  return (
    <div className={`flex flex-col h-full min-h-0 bg-slate-900/40 relative ${embedded ? '' : 'max-w-5xl mx-auto w-full glass rounded-3xl overflow-hidden shadow-2xl'}`}>
      <div className="px-4 sm:px-6 py-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">Tu Asistente Financiero</h2>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${isTyping ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                {isTyping ? 'Escribiendo...' : 'En línea'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 custom-scrollbar">
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-4 border border-slate-700/50">
              <Bot className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-slate-200 font-semibold">¡Hola! Soy tu asistente de Ingresos y Egresos</h3>
            <p className="text-slate-500 text-sm mt-2 max-w-xs">
              Escríbeme normal: registro, borro, consulto y razono contigo sobre tus finanzas.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[92%] sm:max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
              msg.sender === 'user'
                ? 'bg-blue-600 text-white rounded-tr-none'
                : 'bg-slate-800 text-slate-100 border border-slate-700/50 rounded-tl-none'
            }`}>
              {msg.text}
            </div>

            {msg.sender === 'bot' && (
              <div className="w-full max-w-[92%] sm:max-w-[85%] mt-2 space-y-2">
                {msg.transactionId && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center gap-3 animate-in zoom-in-95 duration-500">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-green-400 uppercase tracking-wider">Movimiento Registrado</p>
                      <p className="text-[10px] text-slate-400">ID: {msg.transactionId.substring(0, 8)}...</p>
                    </div>
                  </div>
                )}

                {msg.summary && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3 animate-in slide-in-from-left-2 duration-500">
                    <div className="flex items-center gap-2 border-b border-slate-700/50 pb-2">
                      <PieChart className="w-4 h-4 text-blue-400" />
                      <p className="text-xs font-bold text-slate-200 uppercase tracking-wider">Resumen del mes</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] text-green-400 font-bold uppercase">
                          <TrendingUp className="w-3 h-3" /> Ingresos
                        </div>
                        <p className="text-sm font-bold text-slate-100">{formatCOP(msg.summary.totalIncome)}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] text-red-400 font-bold uppercase">
                          <TrendingDown className="w-3 h-3" /> Gastos
                        </div>
                        <p className="text-sm font-bold text-slate-100">{formatCOP(msg.summary.totalExpenses)}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Balance Neto</span>
                      <span className={`text-sm font-black ${msg.summary.balance >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                        {formatCOP(msg.summary.balance)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {msg.sender === 'bot' && msg.suggestedNextQuestion && msg === messages[messages.length - 1] && (
              <div className="flex flex-wrap gap-2 mt-3 ml-2">
                <button
                  onClick={() => handleSend(msg.suggestedNextQuestion)}
                  className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition-all flex items-center gap-2 group"
                >
                  <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
                  {msg.suggestedNextQuestion}
                </button>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-start gap-2">
            <div className="bg-slate-800 border border-slate-700/50 px-4 py-3 rounded-2xl rounded-tl-none flex gap-1 shadow-sm">
              <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {selectedImage && (
        <div className="px-4 py-2 border-t border-slate-700/50 bg-slate-800/50 flex items-center gap-3 animate-in slide-in-from-bottom-2">
          <div className="relative group">
            <img src={selectedImage.preview} alt="Preview" className="w-12 h-12 object-cover rounded-lg border border-slate-600" />
            <button onClick={() => setSelectedImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-lg hover:bg-red-400 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[10px] text-slate-400 font-bold uppercase truncate">Imagen preparada para analizar</p>
            <p className="text-[9px] text-slate-500">Formato: {selectedImage.mime}</p>
          </div>
        </div>
      )}

      <div className="p-3 sm:p-4 border-t border-slate-700/50 bg-slate-800/30">
        {chatError && (
          <div className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{chatError.friendly}</p>
                <p className="break-words text-xs text-red-200/80">
                  Código: {chatError.code || 'desconocido'}
                  {chatError.message ? ` · Mensaje: ${chatError.message}` : ''}
                  {chatError.details ? ` · Detalles: ${chatError.details}` : ''}
                </p>
              </div>
            </div>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2 items-end">
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-11 h-11 sm:w-12 sm:h-12 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl flex items-center justify-center transition-all border border-slate-700/50 shrink-0"
            title="Adjuntar imagen"
          >
            <Camera className="w-5 h-5" />
          </button>

          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={selectedImage ? 'Añade un comentario o envía...' : "Escríbeme normal: registra, borra, consulta o razona conmigo..."}
              disabled={loading}
              rows={1}
              className="w-full bg-slate-900/60 border border-slate-700/50 text-slate-100 text-sm px-4 py-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600 transition-all shadow-inner resize-none min-h-[48px] max-h-32 py-[13px]"
            />
          </div>

          <button
            type="submit"
            disabled={(!input.trim() && !selectedImage) || loading}
            className="w-11 h-11 sm:w-12 sm:h-12 bg-gradient-to-tr from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-blue-500/20 active:scale-95 shrink-0"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin text-blue-200" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
