import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, callChatWithBot } from '../lib/firebase';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import type { ChatMessage } from '../types';
import { formatCOP } from '../types';
import { Send, Bot, Loader2, RefreshCw, CheckCircle2, TrendingUp, TrendingDown, PieChart } from 'lucide-react';

interface ChatPageProps {
  embedded?: boolean;
}

export function ChatPage({ embedded = false }: ChatPageProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
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

  const handleSend = async (text: string = input) => {
    const messageText = text.trim();
    if (!messageText || !user || loading) return;

    setInput('');
    setLoading(true);
    setIsTyping(true);

    try {
      // Solo llamamos a la función de Firebase. 
      // El backend se encarga de guardar el mensaje del usuario y la respuesta del bot.
      await callChatWithBot({ message: messageText });
    } catch (error) {
      console.error('Chat error:', error);
      // Opcionalmente podrías mostrar un toast o mensaje de error local.
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
              Cuéntame qué has comprado hoy o pregúntame cómo van tus finanzas. ¡Estoy para ayudarte!
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

      {/* Input */}
      <div className="p-4 border-t border-slate-700/50 bg-slate-800/30">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ej: 'Me gasté 15k en un café'..."
            disabled={loading}
            className="flex-1 bg-slate-900/60 border border-slate-700/50 text-slate-100 text-sm px-4 py-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600 transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-12 h-12 bg-gradient-to-tr from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-blue-500/20 active:scale-95"
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
