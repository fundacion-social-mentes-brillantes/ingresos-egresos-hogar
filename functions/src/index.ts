import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';
import { startOfMonth, endOfMonth, subDays, startOfDay, endOfDay } from 'date-fns';

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
    currency: string;
    category: string;
    accountName: string;
    description: string;
    date: string;
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

// ── Bot Logic ──────────────────────────────────────────────────────────────

async function callDeepSeek(userMessage: string, context: string, chatHistory: any[], apiKey: string): Promise<BotAction> {
  const systemPrompt = `
Eres un asistente financiero personal para ingresos y egresos del hogar. Tu trabajo es ayudar al usuario a entender, registrar y organizar su dinero de forma sencilla. 
Hablas en español colombiano natural, con tono cercano, tranquilo, empático y útil. No eres un contador rígido ni un asesor financiero de inversiones. 
Eres como un entrenador financiero práctico: ayudas a registrar gastos, ingresos, consultar balances, detectar hábitos y proponer mejoras simples. 

REGLAS DE PERSONALIDAD:
- Sé cercano y amable. Usa frases como "Te entiendo", "Vamos a mirarlo con calma", "Listo, ya registré eso".
- Habla como un colombiano: natural, sin sonar robótico.
- No juzgues los gastos del usuario.
- Si el usuario está preocupado, usa un tono calmado.
- Si registras algo, confírmalo naturalmente en el texto.
- Si no estás seguro de algo, pregunta amablemente (intent: clarify).

REGLAS TÉCNICAS:
- Responde SIEMPRE en formato JSON estricto.
- "intent" debe ser uno de: create_transaction, query_summary, analyze_behavior, financial_advice, update_transaction, delete_transaction, clarify, conversation_only.
- "replyToUser" es la respuesta humana que verá el usuario.
- "shouldCreateTransaction" es true solo si el usuario dio datos claros de un gasto o ingreso.
- Categorías: Alimentación, Transporte, Hogar, Salud, Educación, Entretenimiento, Ropa, Tecnología, Ahorro, Ingreso, Otros.
- Cuentas: Efectivo, Nequi, Daviplata, Banco. (Por defecto: Efectivo).
- "suggestedNextQuestion" ayuda a mantener la conversación fluida.

CONTEXTO DEL USUARIO:
${context}

FECHA ACTUAL: ${new Date().toISOString()}
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
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
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const { message } = request.data;
  const uid = request.auth.uid;
  const db = admin.firestore();

  // 1. Get user context
  const [accountsSnap, recentTxsSnap, chatHistorySnap] = await Promise.all([
    db.collection('users').doc(uid).collection('accounts').get(),
    db.collection('users').doc(uid).collection('transactions').orderBy('date', 'desc').limit(10).get(),
    db.collection('users').doc(uid).collection('chatMessages').orderBy('createdAt', 'desc').limit(5).get()
  ]);

  // Context for IA
  const accounts = accountsSnap.docs.map(d => ({ name: d.data().name, id: d.id }));
  const recentTxs = recentTxsSnap.docs.map(d => ({
    desc: d.data().description,
    amt: d.data().amount,
    type: d.data().type,
    cat: d.data().category,
    date: d.data().date.toDate().toISOString()
  }));
  
  const chatHistory = chatHistorySnap.docs.reverse().map(d => d.data());

  // 2. Get monthly summary for extra context
  const start = startOfMonth(new Date());
  const end = endOfMonth(new Date());
  const monthlyTxsSnap = await db.collection('users').doc(uid).collection('transactions')
    .where('date', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('date', '<=', admin.firestore.Timestamp.fromDate(end))
    .get();
  
  const monthlyData = monthlyTxsSnap.docs.map(d => d.data());
  const totalIncome = monthlyData.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = monthlyData.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  
  const context = `
  Cuentas: ${accounts.map(a => a.name).join(', ')}
  Movimientos recientes: ${JSON.stringify(recentTxs)}
  Resumen mes actual: Ingresos $${totalIncome}, Gastos $${totalExpenses}, Balance $${totalIncome - totalExpenses}
  `;

  // 3. Call IA
  const botAction = await callDeepSeek(message, context, chatHistory, DEEPSEEK_API_KEY.value());

  // 4. Execute action if needed
  let transactionCreated = null;
  if (botAction.shouldCreateTransaction && botAction.transaction && botAction.confidence >= 0.75) {
    const tx = botAction.transaction;
    const accMatch = accounts.find(a => a.name.toLowerCase() === tx.accountName.toLowerCase());
    
    const docRef = await db.collection('users').doc(uid).collection('transactions').add({
      ...tx,
      accountId: accMatch?.id || 'unknown',
      currency: 'COP',
      source: 'bot',
      confidence: botAction.confidence,
      date: admin.firestore.Timestamp.now(), 
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rawText: message
    });
    
    const newDoc = await docRef.get();
    transactionCreated = { id: newDoc.id, ...newDoc.data() };
  }

  return {
    replyToUser: botAction.replyToUser,
    intent: botAction.intent,
    suggestedNextQuestion: botAction.suggestedNextQuestion,
    transactionCreated
  };
});

export const getFinancialSummary = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
  
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
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
  
  const uid = request.auth.uid;
  const db = admin.firestore();
  
  const accsCol = db.collection('users').doc(uid).collection('accounts');
  const existingAccs = await accsCol.limit(1).get();
  
  if (!existingAccs.empty) return { success: false, message: 'Already seeded' };

  const defaults = [
    { name: 'Efectivo', type: 'cash', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Nequi', type: 'nequi', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Daviplata', type: 'daviplata', initialBalance: 0, currentBalance: 0, active: true }
  ];

  const batch = db.batch();
  defaults.forEach(acc => {
    const ref = accsCol.doc();
    batch.set(ref, { ...acc, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  await batch.commit();
  return { success: true };
});
