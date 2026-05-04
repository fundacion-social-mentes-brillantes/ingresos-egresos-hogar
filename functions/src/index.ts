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
  };
  needsConfirmation?: boolean;
  confidence: number;
  emotionalTone?: 'calm' | 'encouraging' | 'alert' | 'neutral';
  suggestedNextQuestion?: string;
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

// ── Bot Logic ──────────────────────────────────────────────────────────────

async function callDeepSeek(userMessage: string, context: string, chatHistory: any[], apiKey: string): Promise<BotAction> {
  const systemPrompt = `
Eres un asistente financiero personal familiar para la app "Ingresos y Egresos Hogar". 
Tu trabajo es ayudar al usuario a entender, registrar y organizar su dinero de forma sencilla y empática.

PERSONALIDAD Y TONO:
- Hablas en español colombiano natural (ej: "Listo", "Dale", "¿Cómo vas?", "Te entiendo").
- Eres cercano, tranquilo, empático y útil. No eres un contador rígido.
- Si el usuario está preocupado o estresado por el dinero, acompáñalo con calma.
- Si el usuario habla de temas cotidianos o no financieros, responde de forma natural y humana; no rechaces la conversación, solo intégrala con tu rol de asistente.

REGLAS DE OPERACIÓN:
- Responde SIEMPRE en formato JSON estricto.
- "intent" debe ser uno de: create_transaction, query_summary, analyze_behavior, financial_advice, update_transaction, delete_transaction, clarify, conversation_only.
- "replyToUser" es tu respuesta humana.
- "shouldCreateTransaction" es true solo si tienes: Tipo (gasto/ingreso), Monto y Descripción clara.
- Si falta información para un registro, usa "intent": "clarify" y pregunta amablemente.
- Fecha: Si detectas una fecha (hoy, ayer, lunes pasado, 15 de marzo), devuélvela en "transaction.date" como YYYY-MM-DD. Si es hoy, usa "today".
- Cuentas comunes: Efectivo, Nequi, Daviplata, Banco. (Default: Efectivo).
- Categorías: Alimentación, Transporte, Hogar, Salud, Educación, Entretenimiento, Ropa, Tecnología, Ahorro, Ingreso, Otros.

IMPORTANTE:
- No inventes números que no estén en el contexto. 
- Si el usuario pregunta "¿cuánto gasté?", usa "intent": "query_summary" para que el sistema calcule los datos reales.
- Sé breve pero cálido.

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

  // 1. Guardar mensaje del usuario inmediatamente
  await chatCol.add({
    text: message,
    sender: 'user',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // 2. Obtener contexto (Cuentas, Transacciones recientes, Historial de chat)
  const [accountsSnap, recentTxsSnap, chatHistorySnap] = await Promise.all([
    db.collection('users').doc(uid).collection('accounts').get(),
    db.collection('users').doc(uid).collection('transactions').orderBy('date', 'desc').limit(10).get(),
    chatCol.orderBy('createdAt', 'desc').limit(12).get()
  ]);

  const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  const recentTxs = recentTxsSnap.docs.map(d => ({
    desc: d.data().description,
    amt: d.data().amount,
    type: d.data().type,
    cat: d.data().category,
    date: d.data().date.toDate().toISOString()
  }));
  
  const chatHistory = chatHistorySnap.docs.reverse().map(d => d.data());

  // 3. Resumen del mes actual para contexto IA
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  const monthlyTxsSnap = await db.collection('users').doc(uid).collection('transactions')
    .where('date', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('date', '<=', admin.firestore.Timestamp.fromDate(end))
    .get();
  
  const monthlyData = monthlyTxsSnap.docs.map(d => d.data());
  const totalIncome = monthlyData.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = monthlyData.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  
  const context = `
  Cuentas disponibles: ${accounts.map(a => `${a.name} ($${a.currentBalance})`).join(', ')}
  Movimientos recientes: ${JSON.stringify(recentTxs)}
  Resumen mes actual: Ingresos $${totalIncome}, Gastos $${totalExpenses}, Balance $${totalIncome - totalExpenses}
  `;

  // 4. Llamar a DeepSeek
  const botAction = await callDeepSeek(message, context, chatHistory, DEEPSEEK_API_KEY.value());

  // 5. Ejecutar acciones basadas en la intención
  let transactionCreated = null;
  let summaryData = null;

  // Acción: Crear transacción
  if (botAction.intent === 'create_transaction' && botAction.shouldCreateTransaction && botAction.transaction && botAction.confidence >= 0.75) {
    const tx = botAction.transaction;
    
    // Buscar cuenta (Case insensitive)
    let account = accounts.find(a => a.name.toLowerCase() === tx.accountName?.toLowerCase());
    if (!account) account = accounts.find(a => a.name === 'Efectivo');
    if (!account && accounts.length > 0) account = accounts[0];

    if (account) {
      const batch = db.batch();
      const txRef = db.collection('users').doc(uid).collection('transactions').doc();
      const accRef = db.collection('users').doc(uid).collection('accounts').doc(account.id);

      const amount = Number(tx.amount);
      const isIncome = tx.type === 'income';

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

      // Actualizar saldo de cuenta
      const balanceChange = isIncome ? amount : -amount;
      batch.update(accRef, {
        currentBalance: admin.firestore.FieldValue.increment(balanceChange),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();
      
      const newDoc = await txRef.get();
      transactionCreated = { id: newDoc.id, ...newDoc.data() };
    }
  }

  // Acción: Consultar resumen (Datos Reales)
  if (botAction.intent === 'query_summary' && botAction.query) {
    const qRange = botAction.query.range;
    let sDate = startOfMonth(new Date());
    let eDate = endOfMonth(new Date());

    if (qRange === 'today') sDate = startOfDay(new Date());
    if (qRange === 'last_3_days') sDate = subDays(startOfDay(new Date()), 2);
    if (qRange === 'last_7_days') sDate = subDays(startOfDay(new Date()), 6);

    const querySnap = await db.collection('users').doc(uid).collection('transactions')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(sDate))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(eDate))
      .get();

    const txs = querySnap.docs.map(d => d.data());
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
    const cats: Record<string, number> = {};
    txs.filter(t => t.type === 'expense').forEach(t => {
      cats[t.category] = (cats[t.category] || 0) + t.amount;
    });

    summaryData = {
      totalIncome: inc,
      totalExpenses: exp,
      balance: inc - exp,
      byCategory: cats,
      range: qRange,
      generatedAt: new Date()
    };

    // Ajustar respuesta humana con datos reales si es necesario
    if (botAction.replyToUser.includes('[DATOS]')) {
      botAction.replyToUser = botAction.replyToUser.replace('[DATOS]', 
        `llevas $${exp.toLocaleString('es-CO')} en gastos y $${inc.toLocaleString('es-CO')} en ingresos. El balance es de $${(inc-exp).toLocaleString('es-CO')}.`
      );
    }
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
});

export const getFinancialSummary = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  
  const uid = request.auth.uid;
  const { range } = request.data;
  const db = admin.firestore();
  
  let startDate = startOfMonth(new Date());
  let endDate = endOfMonth(new Date());

  if (range === 'last_3_days') startDate = subDays(startOfDay(new Date()), 2);
  if (range === 'last_7_days') startDate = subDays(startOfDay(new Date()), 6);
  if (range === 'today') startDate = startOfDay(new Date());

  const txsSnap = await db.collection('users').doc(uid).collection('transactions')
    .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
    .get();

  const transactions = txsSnap.docs.map(d => d.data());
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  
  const byCategory: Record<string, number> = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });

  return {
    totalIncome: income,
    totalExpenses: expenses,
    balance: income - expenses,
    byCategory,
    range,
    generatedAt: new Date()
  };
});

export const seedDefaultUserData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  
  const uid = request.auth.uid;
  const db = admin.firestore();
  
  const accsCol = db.collection('users').doc(uid).collection('accounts');
  const existingAccs = await accsCol.limit(1).get();
  
  if (!existingAccs.empty) return { success: false, message: 'Ya inicializado.' };

  const defaults = [
    { name: 'Efectivo', type: 'cash', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Nequi', type: 'nequi', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Daviplata', type: 'daviplata', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Banco', type: 'bank', initialBalance: 0, currentBalance: 0, active: true }
  ];

  const batch = db.batch();
  defaults.forEach(acc => {
    const ref = accsCol.doc();
    batch.set(ref, { ...acc, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  await batch.commit();
  return { success: true };
});
