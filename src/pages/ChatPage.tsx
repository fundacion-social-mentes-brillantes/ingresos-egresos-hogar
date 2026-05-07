import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { auth, db, callChatWithBot } from '../lib/firebase';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { addAccount, addChatMessage, addTransaction, getAccounts, getTransactionsByRange } from '../lib/firestore';
import type { Account, ChatMessage, FinancialSummary, TransactionType } from '../types';
import { DEFAULT_ACCOUNTS, formatCOP } from '../types';
import { Send, Bot, Loader2, RefreshCw, CheckCircle2, TrendingUp, TrendingDown, PieChart, X, Camera, AlertCircle } from 'lucide-react';

interface ChatPageProps {
  embedded?: boolean;
}

interface ChatErrorState {
  friendly: string;
  code?: string;
  message?: string;
  details?: string;
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

  if (code === 'functions/unauthenticated') {
    return {
      friendly: 'Tu sesión se venció. Cierra sesión y vuelve a entrar con Google.',
      code,
      message,
      details,
    };
  }

  if (code === 'functions/invalid-argument') {
    return {
      friendly: 'Hubo un problema con los datos enviados. Si enviaste imagen, intenta con una más liviana.',
      code,
      message,
      details,
    };
  }

  if (code === 'functions/internal') {
    return {
      friendly: 'No pude procesar el mensaje por un error interno. Código: functions/internal.',
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
  const match = normalizeText(value).match(/(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*(mil|lucas?|k|millones?|millon)?/i);
  if (!match) return 0;

  const rawNumber = match[1].replace(',', '.');
  const base = Number.parseFloat(rawNumber);
  if (!Number.isFinite(base)) return 0;

  const scale = match[2] || '';
  if (scale.startsWith('mil') || scale.startsWith('luca') || scale === 'k') return base * 1000;
  if (scale.startsWith('millon')) return base * 1000000;
  return base;
}

function inferTransactionType(message: string): TransactionType | null {
  const text = normalizeText(message);
  const incomeWords = ['me entro', 'recibi', 'me pagaron', 'cobre', 'me consignaron', 'me depositaron', 'vendi', 'ingrese'];
  const expenseWords = ['me gaste', 'gaste', 'compre', 'pague', 'almorce', 'recargue', 'tanquie', 'me toco pagar'];

  if (incomeWords.some((word) => text.includes(word))) return 'income';
  if (expenseWords.some((word) => text.includes(word))) return 'expense';
  return null;
}

function inferDescription(message: string): string {
  const description = message
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '')
    .replace(/\b(me gaste|gast[eé]|compre|compr[eé]|pague|pagu[eé]|me pagaron|recibi|recib[ií]|cobre|cobr[eé]|en|por|con|de)\b/gi, ' ')
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

function shouldUseLocalFallback(error: any): boolean {
  const code = error?.code || '';
  return code !== 'functions/unauthenticated' && code !== 'functions/invalid-argument';
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

async function runLocalChatFallback(uid: string, message: string, hasImage: boolean) {
  const text = normalizeText(message);
  let replyToUser = 'Te leo. Puedes contarme un gasto, un ingreso o preguntarme cómo va el mes.';
  let intent = 'conversation_only';
  let suggestedNextQuestion = '¿Quieres registrar algo o revisar cómo va el mes?';
  let transactionId: string | undefined;
  let summary: FinancialSummary | undefined;

  await addChatMessage(uid, {
    text: message,
    sender: 'user',
  });

  if (hasImage) {
    intent = 'clarify';
    replyToUser = 'No pude leer la imagen automáticamente en este momento. Escríbeme el valor y qué compraste o pagaste, y lo registro por ti.';
    suggestedNextQuestion = '¿Cuánto fue y en qué lo pagaste?';
  } else if (/^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey)\b/.test(text)) {
    replyToUser = '¡Hola! Estoy listo para ayudarte con tus ingresos y gastos. Puedes escribirme algo como: “me gasté 10 mil en un helado” o preguntarme “¿cómo voy este mes?”.';
    suggestedNextQuestion = '¿Quieres registrar un gasto o revisar tu resumen del mes?';
  } else if (text.includes('como voy') || text.includes('cuanto gaste') || text.includes('cuanto he gastado') || text.includes('resumen') || text.includes('balance')) {
    intent = 'query_summary';
    summary = await getLocalMonthlySummary(uid);
    replyToUser = `Listo, en este mes llevas ${formatCOP(summary.totalExpenses)} en gastos y ${formatCOP(summary.totalIncome)} en ingresos. Tu balance neto es de ${formatCOP(summary.balance)}.`;
    suggestedNextQuestion = '';
  } else {
    const type = inferTransactionType(message);
    const amount = normalizeAmount(message);

    if (type && amount > 0) {
      const accounts = await ensureLocalAccounts(uid);
      const account = accounts.find((item) => normalizeText(item.name) === 'efectivo') || accounts[0];

      if (account) {
        const description = inferDescription(message);
        const created = await addTransaction(uid, {
          type,
          amount,
          currency: 'COP',
          category: inferCategory(message, type),
          accountId: account.id,
          accountName: account.name,
          description,
          date: new Date(),
          rawText: message,
          source: 'bot',
          confidence: 0.8,
        });

        intent = 'create_transaction';
        transactionId = created.id;
        replyToUser = type === 'income'
          ? `Listo, registré ese ingreso por ${formatCOP(amount)}.`
          : `Listo, registré ese gasto por ${formatCOP(amount)}.`;
        suggestedNextQuestion = '¿Quieres ver el resumen del mes?';
      } else {
        intent = 'clarify';
        replyToUser = 'Entendí el movimiento, pero no encontré una cuenta disponible para guardarlo. Revisa tus cuentas e inténtalo de nuevo.';
        suggestedNextQuestion = '¿Quieres revisar tus cuentas?';
      }
    }
  }

  await addChatMessage(uid, {
    text: replyToUser,
    sender: 'bot',
    emotionalTone: 'neutral',
    suggestedNextQuestion,
    transactionId,
    summary,
    intent,
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

    const q = query(
      collection(db, `users/${user.uid}/chatMessages`),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage))
        .reverse();
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setChatError({ friendly: 'Por favor selecciona una imagen válida.', code: 'imagen-invalida' });
      return;
    }

    // Limit original size to 8MB just in case
    if (file.size > 8 * 1024 * 1024) {
      setChatError({ friendly: 'La imagen es demasiado grande. Intenta con una de menos de 8MB.', code: 'imagen-pesada' });
      return;
    }

    setChatError(null);

    // Compress/Resize logic
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1280;

        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        setSelectedImage({
          base64: compressedBase64.split(',')[1],
          mime: 'image/jpeg',
          preview: compressedBase64
        });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    // Clear input so same file can be re-selected if removed
    e.target.value = '';
  };

  const handleSend = async (text: string = input) => {
    const messageText = text.trim();
    if (!messageText && !selectedImage) return;
    if (loading) return;
    if (!user || !auth.currentUser) {
      setChatError({
        friendly: 'Tu sesión no está activa. Cierra sesión y vuelve a entrar.',
        code: 'functions/unauthenticated',
      });
      return;
    }

    const finalMessage = messageText || "Analiza esta imagen y dime si hay un gasto o ingreso para registrar.";
    
    setInput('');
    const imageData = selectedImage;
    setSelectedImage(null);
    setLoading(true);
    setIsTyping(true);
    setChatError(null);

    try {
      await auth.currentUser.getIdToken(true);
      await callChatWithBot({ 
        message: finalMessage,
        imageBase64: imageData?.base64,
        imageMimeType: imageData?.mime
      });
    } catch (error: any) {
      console.error('Chat error full:', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        raw: error,
      });

      if (shouldUseLocalFallback(error)) {
        try {
          console.warn('Using local chat fallback because callable failed:', error?.code || error?.message || error);
          await runLocalChatFallback(user.uid, finalMessage, Boolean(imageData?.base64));
          return;
        } catch (fallbackError: any) {
          console.error('Local chat fallback failed:', {
            code: fallbackError?.code,
            message: fallbackError?.message,
            details: fallbackError?.details,
            raw: fallbackError,
          });
        }
      }

      setChatError(getFriendlyChatError(error));
    } finally {
      setLoading(false);
      setIsTyping(false);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-slate-900/40 relative ${embedded ? '' : 'max-w-4xl mx-auto w-full glass rounded-3xl overflow-hidden shadow-2xl'}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/20">
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

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
      >
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-4 border border-slate-700/50">
              <Bot className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-slate-200 font-semibold">¡Hola! Soy tu asistente de Ingresos y Egresos</h3>
            <p className="text-slate-500 text-sm mt-2 max-w-xs">
              Cuéntame qué has comprado hoy, pregúntame cómo van tus finanzas o <b>envíame una foto de un recibo</b>.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-slate-800 text-slate-100 border border-slate-700/50 rounded-tl-none'
              }`}
            >
              {msg.text}
            </div>

            {/* Rich Widgets */}
            {msg.sender === 'bot' && (
              <div className="w-full max-w-[85%] mt-2 space-y-2">
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
                      <p className="text-xs font-bold text-slate-200 uppercase tracking-wider">Resumen de {msg.summary.range === 'this_month' ? 'el mes' : msg.summary.range}</p>
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
            
            {/* Suggested Chips (Only on the last bot message) */}
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

      {/* Image Preview Overlay */}
      {selectedImage && (
        <div className="px-4 py-2 border-t border-slate-700/50 bg-slate-800/50 flex items-center gap-3 animate-in slide-in-from-bottom-2">
          <div className="relative group">
            <img src={selectedImage.preview} alt="Preview" className="w-12 h-12 object-cover rounded-lg border border-slate-600" />
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-lg hover:bg-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[10px] text-slate-400 font-bold uppercase truncate">Imagen preparada para analizar</p>
            <p className="text-[9px] text-slate-500">Formato: {selectedImage.mime}</p>
          </div>
        </div>
      )}

      {/* Input Form */}
      <div className="p-4 border-t border-slate-700/50 bg-slate-800/30">
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
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2 items-end"
        >
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleImageSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-12 h-12 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl flex items-center justify-center transition-all border border-slate-700/50 shrink-0"
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
              placeholder={selectedImage ? "Añade un comentario o envía..." : "Ej: 'Me gasté 15k en un café'..."}
              disabled={loading}
              rows={1}
              className="w-full bg-slate-900/60 border border-slate-700/50 text-slate-100 text-sm px-4 py-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600 transition-all shadow-inner resize-none min-h-[48px] max-h-32 py-[13px]"
            />
          </div>

          <button
            type="submit"
            disabled={(!input.trim() && !selectedImage) || loading}
            className="w-12 h-12 bg-gradient-to-tr from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-blue-500/20 active:scale-95 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-200" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
