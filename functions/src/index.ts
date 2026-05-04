import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';
import { startOfMonth, endOfMonth, subDays, startOfDay, format } from 'date-fns';

admin.initializeApp();

const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');

// ── Types ──────────────────────────────────────────────────────────────────

interface BotAction {
  intent: 
    | 'create_transaction' 
    | 'query_summary' 
    | 'analyze_behavior' 
    | 'financial_advice' 
    | 'update_transaction' 
    | 'delete_transaction' 
    | 'clarify' 
    | 'conversation_only';
  replyToUser: string;
  shouldCreateTransaction?: boolean;
  transaction?: {
    type: 'income' | 'expense';
    amount: number;
    currency: 'COP';
    category: string;
    accountName: string;
    description: string;
    date: string; // YYYY-MM-DD or 'today'
  };
  query?: {
    range: 'today' | 'last_3_days' | 'last_7_days' | 'this_month' | 'custom';
    metric: 'expenses' | 'income' | 'balance' | 'by_category' | 'behavior_analysis';
    category?: string;
  };
  needsConfirmation?: boolean;
  confidence: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
}

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  byCategory: Record<string, number>;
  topCategory: { name: string; amount: number } | null;
  transactionCount: number;
  range: string;
  generatedAt: Date;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseTransactionDate(value?: string): admin.firestore.Timestamp {
  if (!value) return admin.firestore.Timestamp.now();
  
  const val = value.toLowerCase();
  if (val === 'today' || val === 'hoy') {
    return admin.firestore.Timestamp.now();
  }
  
  if (val === 'yesterday' || val === 'ayer') {
    return admin.firestore.Timestamp.fromDate(subDays(new Date(), 1));
  }
  
  // Try ISO YYYY-MM-DD
  const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    // Force noon in Colombia time to avoid day shifts
    const dateStr = `${val}T12:00:00-05:00`;
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return admin.firestore.Timestamp.fromDate(date);
    }
  }
  
  return admin.firestore.Timestamp.now();
}

function normalizeCategory(cat: string): string {
  if (!cat) return '';
  return cat
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove accents/tildes
}

async function getSummaryForUser(uid: string, range: string, category?: string): Promise<FinancialSummary> {
  const db = admin.firestore();
  let startDate = startOfMonth(new Date());
  let endDate = endOfMonth(new Date());

  if (range === 'today') startDate = startOfDay(new Date());
  if (range === 'last_3_days') startDate = subDays(startOfDay(new Date()), 2);
  if (range === 'last_7_days') startDate = subDays(startOfDay(new Date()), 6);

  const query = db.collection('users').doc(uid).collection('transactions')
    .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate));

  const snap = await query.get();
  let txs = snap.docs.map(d => d.data());

  if (category) {
    const normTarget = normalizeCategory(category);
    txs = txs.filter(t => t.category && normalizeCategory(t.category) === normTarget);
  }
  
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  
  const cats: Record<string, number> = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    cats[t.category] = (cats[t.category] || 0) + t.amount;
  });

  const sortedCats = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const topCategory = sortedCats.length > 0 ? { name: sortedCats[0][0], amount: sortedCats[0][1] } : null;

  return {
    totalIncome: income,
    totalExpenses: expenses,
    balance: income - expenses,
    byCategory: cats,
    topCategory,
    transactionCount: txs.length,
    range,
    generatedAt: new Date()
  };
}

async function ensureDefaultAccounts(uid: string): Promise<any[]> {
  const db = admin.firestore();
  const accsCol = db.collection('users').doc(uid).collection('accounts');
  const existingAccs = await accsCol.get();
  
  if (!existingAccs.empty) {
    return existingAccs.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const defaults = [
    { name: 'Efectivo', type: 'cash', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Nequi', type: 'nequi', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Daviplata', type: 'daviplata', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Banco', type: 'bank', initialBalance: 0, currentBalance: 0, active: true }
  ];

  const batch = db.batch();
  const created: any[] = [];
  defaults.forEach(acc => {
    const ref = accsCol.doc();
    const data = { ...acc, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    batch.set(ref, data);
    created.push({ id: ref.id, ...data });
  });

  await batch.commit();
  return created;
}

// ── Bot Logic ──────────────────────────────────────────────────────────────

async function callDeepSeek(userMessage: string, context: string, chatHistory: any[], apiKey: string): Promise<BotAction> {
  const systemPrompt = `
Eres un asistente financiero personal familiar para la app "Ingresos y Egresos Hogar". 
Tu trabajo es ayudar al usuario a entender, registrar y organizar su dinero de forma sencilla y empática.

PERSONALIDAD Y TONO:
- Hablas en español colombiano natural (ej: "Listo", "Dale", "¿Cómo vas?", "Te entiendo").
- Eres cercano, tranquilo, empático y útil. No eres un contador rígido.
- Si el usuario está preocupado o estresado por el dinero, acompáñalo con calma.
- Si el usuario habla de temas cotidianos o no financieros, responde de forma natural y humana.

REGLAS DE OPERACIÓN:
- Responde SIEMPRE en formato JSON estricto.
- "intent" debe ser uno de: create_transaction, query_summary, analyze_behavior, financial_advice, update_transaction, delete_transaction, clarify, conversation_only.
- "replyToUser" es tu respuesta humana.
- "shouldCreateTransaction" es true solo si tienes: Tipo (gasto/ingreso), Monto y Descripción clara.
- Si falta información para un registro, usa "intent": "clarify" y pregunta amablemente.
- Para query_summary, analyze_behavior y financial_advice, NO inventes números. Devuelve el JSON con el intent correcto y el sistema se encargará de poner los datos reales.
- Fecha: Si detectas una fecha (hoy, ayer, lunes pasado, 15 de marzo), devuélvela en "transaction.date" como YYYY-MM-DD. Si es hoy, usa "today".
- Categorías: Alimentación, Transporte, Hogar, Salud, Educación, Entretenimiento, Ropa, Tecnología, Ahorro, Ingreso, Otros.

QUERY_SUMMARY:
- Si el usuario pregunta por gastos de una categoría específica, incluye "category" en el objeto "query".

EDICIÓN Y BORRADO:
- Si el usuario pide editar o borrar (update_transaction, delete_transaction), responde con "clarify" diciendo que por ahora no puedes hacerlo automáticamente y que debe hacerlo manualmente en la lista de transacciones.

CONTEXTO FINANCIERO ACTUAL:
${context}

FECHA ACTUAL (Colombia): ${format(new Date(), 'yyyy-MM-dd HH:mm')}
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(m => ({
      role: m.sender === 'bot' ? 'assistant' : 'user',
      content: m.text
    })),
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: messages,
        response_format: { type: 'json_object' },
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
    return result as BotAction;
  } catch (error) {
    console.error('DeepSeek Error:', error);
    throw new HttpsError('internal', 'Error comunicándose con la IA.');
  }
}

// ── Callable Functions ─────────────────────────────────────────────────────

export const chatWithBot = onCall({ secrets: [DEEPSEEK_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'El usuario debe estar autenticado.');
  }

  const { message } = request.data;
  if (!message || typeof message !== 'string') {
    throw new HttpsError('invalid-argument', 'El mensaje es obligatorio.');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const chatCol = db.collection('users').doc(uid).collection('chatMessages');

  try {
    // 1. Guardar mensaje del usuario inmediatamente
    await chatCol.add({
      text: message,
      sender: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Obtener contexto (Cuentas, Transacciones recientes, Historial de chat)
    // EXCLUIMOS el mensaje actual del historial para no duplicarlo en la llamada a la IA
    const [accountsSnap, recentTxsSnap, chatHistorySnap] = await Promise.all([
      db.collection('users').doc(uid).collection('accounts').get(),
      db.collection('users').doc(uid).collection('transactions').orderBy('date', 'desc').limit(10).get(),
      chatCol.orderBy('createdAt', 'desc').limit(13).get() // Pedimos 13 para descartar el último (el actual)
    ]);

    let accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    const recentTxs = recentTxsSnap.docs.map(d => ({
      desc: d.data().description,
      amt: d.data().amount,
      type: d.data().type,
      cat: d.data().category,
      date: d.data().date.toDate().toISOString()
    }));
    
    // Filtrar el mensaje actual (el más reciente) para evitar duplicación en callDeepSeek
    const allHistory = chatHistorySnap.docs.reverse();
    const chatHistory = allHistory.length > 0 ? allHistory.slice(0, -1).map(d => d.data()) : [];

    // 3. Resumen del mes actual para contexto IA
    const monthlySummary = await getSummaryForUser(uid, 'this_month');
    
    const context = `
    Cuentas: ${accounts.map(a => `${a.name} ($${a.currentBalance})`).join(', ')}
    Movimientos recientes: ${JSON.stringify(recentTxs)}
    Resumen mes: Ingresos $${monthlySummary.totalIncome}, Gastos $${monthlySummary.totalExpenses}, Balance $${monthlySummary.balance}
    `;

    // 4. Llamar a DeepSeek
    const botAction = await callDeepSeek(message, context, chatHistory, DEEPSEEK_API_KEY.value());

    // 5. Ejecutar acciones basadas en la intención
    let transactionCreated = null;
    let summaryData: any = null;

    // Asegurar que existan cuentas si se va a crear transacción
    if (botAction.intent === 'create_transaction' && accounts.length === 0) {
      accounts = await ensureDefaultAccounts(uid);
    }

    // Acción: Crear transacción
    if (botAction.intent === 'create_transaction' && botAction.shouldCreateTransaction && botAction.transaction && botAction.confidence >= 0.75) {
      const tx = botAction.transaction;
      const amount = Number(tx.amount);

      if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
        botAction.replyToUser = "No alcancé a identificar bien el valor. ¿Me dices cuánto fue?";
        botAction.intent = 'clarify';
        botAction.shouldCreateTransaction = false;
      } else {
        let account = accounts.find(a => a.name.toLowerCase() === tx.accountName?.toLowerCase());
        if (!account) account = accounts.find(a => a.name === 'Efectivo') || accounts[0];

        if (account) {
          const batch = db.batch();
          const txRef = db.collection('users').doc(uid).collection('transactions').doc();
          const accRef = db.collection('users').doc(uid).collection('accounts').doc(account.id);

          batch.set(txRef, {
            ...tx,
            amount,
            accountId: account.id,
            accountName: account.name,
            currency: 'COP',
            source: 'bot',
            confidence: botAction.confidence,
            date: parseTransactionDate(tx.date),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rawText: message
          });

          const balanceChange = tx.type === 'income' ? amount : -amount;
          batch.update(accRef, {
            currentBalance: admin.firestore.FieldValue.increment(balanceChange),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          await batch.commit();
          const newDoc = await txRef.get();
          transactionCreated = { id: newDoc.id, ...newDoc.data() };
        } else {
          botAction.replyToUser = "Lo siento, no pude encontrar una cuenta para registrar el movimiento. Por favor, crea una cuenta primero en la configuración.";
          botAction.intent = 'clarify';
        }
      }
    }

    // Acción: Consultar resumen o por categoría
    if (botAction.intent === 'query_summary' && botAction.query) {
      const range = botAction.query.range || 'this_month';
      const cat = botAction.query.category;
      summaryData = await getSummaryForUser(uid, range, cat);

      if (cat) {
        const catSpent = summaryData.totalExpenses;
        botAction.replyToUser = `En ${cat} llevas gastados $${catSpent.toLocaleString('es-CO')} en lo que va de ${range === 'this_month' ? 'el mes' : range}.`;
        if (range === 'this_month') {
          const generalSummary = await getSummaryForUser(uid, 'this_month');
          botAction.replyToUser += ` Tus gastos totales del mes van en $${generalSummary.totalExpenses.toLocaleString('es-CO')}.`;
        }
      } else {
        botAction.replyToUser = `Listo, revisé tus movimientos. En ${range === 'this_month' ? 'este mes' : range} llevas $${summaryData.totalExpenses.toLocaleString('es-CO')} en gastos y $${summaryData.totalIncome.toLocaleString('es-CO')} en ingresos. Tu balance neto es de $${summaryData.balance.toLocaleString('es-CO')}.`;
        if (summaryData.topCategory) {
          botAction.replyToUser += ` La categoría con más gastos es ${summaryData.topCategory.name} con $${summaryData.topCategory.amount.toLocaleString('es-CO')}.`;
        }
      }
    }

    // Acción: Analizar comportamiento
    if (botAction.intent === 'analyze_behavior') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      
      if (summaryData.transactionCount === 0) {
        botAction.replyToUser = "Todavía no tengo suficientes datos para analizar tu comportamiento. ¡Empieza a registrar tus gastos e ingresos y te ayudaré!";
      } else {
        const isOverspending = summaryData.totalExpenses > summaryData.totalIncome;
        botAction.replyToUser = `He analizado tus movimientos de este mes. Llevas un gasto promedio de $${Math.round(summaryData.totalExpenses / 30).toLocaleString('es-CO')} al día. `;
        
        if (summaryData.topCategory) {
          botAction.replyToUser += `Veo que tu mayor gasto es en ${summaryData.topCategory.name}. `;
        }
        
        if (isOverspending) {
          botAction.replyToUser += "Tus gastos están superando tus ingresos este mes, tratemos de buscar dónde podemos recortar un poco para estar más tranquilos.";
        } else {
          botAction.replyToUser += "Vas por buen camino con un balance positivo. ¡Sigue así!";
        }
      }
    }

    // Acción: Consejo financiero
    if (botAction.intent === 'financial_advice') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      if (summaryData.totalExpenses === 0) {
        botAction.replyToUser = "Mi consejo hoy es que empieces registrando hasta el gasto más pequeño. Así sabremos exactamente por dónde se va el dinero.";
      } else {
        botAction.replyToUser = "Basado en tus datos, te sugiero: ";
        if (summaryData.topCategory) {
          botAction.replyToUser += `1. Intenta reducir un 10% tus gastos en ${summaryData.topCategory.name} la próxima semana. `;
        }
        botAction.replyToUser += "2. Antes de un gasto grande, pregúntate si es una necesidad o un gusto. 3. Revisa tus suscripciones que tal vez no usas tanto.";
      }
    }

    // Manejar update/delete con clarify
    if (botAction.intent === 'update_transaction' || botAction.intent === 'delete_transaction') {
      botAction.replyToUser = "Por ahora no puedo editar o borrar movimientos directamente desde el chat. Porfa, ve a la pestaña de 'Movimientos' y hazlo manualmente desde ahí.";
      botAction.intent = 'clarify';
    }

    // 6. Guardar respuesta del bot en el chat
    const botMsg: any = {
      text: botAction.replyToUser,
      sender: 'bot',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      intent: botAction.intent,
      emotionalTone: botAction.emotionalTone || 'neutral',
      suggestedNextQuestion: botAction.suggestedNextQuestion || ''
    };

    if (transactionCreated) botMsg.transactionId = (transactionCreated as any).id;
    if (summaryData) botMsg.summary = summaryData;

    await chatCol.add(botMsg);

    return {
      replyToUser: botAction.replyToUser,
      intent: botAction.intent,
      emotionalTone: botAction.emotionalTone,
      suggestedNextQuestion: botAction.suggestedNextQuestion,
      transactionCreated,
      summary: summaryData
    };

  } catch (error: any) {
    console.error('Chat Error:', error);
    
    // Guardar mensaje de error en el chat para el usuario
    await chatCol.add({
      text: "Tuve un problema técnico al procesar eso. ¿Me lo puedes repetir de forma más sencilla?",
      sender: 'bot',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      intent: 'clarify'
    });

    throw new HttpsError('internal', error.message || 'Error interno del servidor.');
  }
});

export const getFinancialSummary = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  const { range, category } = request.data;
  return await getSummaryForUser(request.auth.uid, range || 'this_month', category);
});

export const seedDefaultUserData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  await ensureDefaultAccounts(request.auth.uid);
  return { success: true };
});
