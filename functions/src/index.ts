import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';
import { startOfMonth, endOfMonth, subDays, startOfDay, format } from 'date-fns';

admin.initializeApp();

const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const PUBLIC_CALLABLE_OPTIONS = { invoker: 'public' as const };

type BotIntent =
  | 'create_transaction'
  | 'query_summary'
  | 'analyze_behavior'
  | 'financial_advice'
  | 'update_transaction'
  | 'delete_transaction'
  | 'clarify'
  | 'conversation_only';

interface BotAction {
  intent: BotIntent;
  replyToUser: string;
  shouldCreateTransaction?: boolean;
  transaction?: {
    type: 'income' | 'expense';
    amount: number | string;
    currency?: 'COP' | string;
    category: string;
    accountName: string;
    description: string;
    date: string;
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

function parseTransactionDate(value?: string): admin.firestore.Timestamp {
  if (!value) return admin.firestore.Timestamp.now();

  const val = String(value).toLowerCase().trim();
  if (val === 'today' || val === 'hoy') return admin.firestore.Timestamp.now();
  if (val === 'yesterday' || val === 'ayer') return admin.firestore.Timestamp.fromDate(subDays(new Date(), 1));

  const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(`${val}T12:00:00-05:00`);
    if (!Number.isNaN(date.getTime())) return admin.firestore.Timestamp.fromDate(date);
  }

  return admin.firestore.Timestamp.now();
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeCategory(cat: string): string {
  return normalizeText(cat);
}

function canonicalCategory(input: string): string {
  const normalized = normalizeCategory(input);

  const mapping: Record<string, string[]> = {
    'Alimentación': ['alimentacion', 'comida', 'mercado', 'supermercado', 'almuerzo', 'desayuno', 'cena', 'restaurante', 'domicilio', 'rappi', 'helado', 'cafe', 'panaderia', 'tienda', 'gaseosa', 'arepa', 'hamburguesa'],
    'Transporte': ['transporte', 'bus', 'taxi', 'uber', 'didi', 'gasolina', 'parqueadero', 'pasaje', 'moto', 'peaje', 'tanqueada', 'tanquie'],
    'Hogar': ['hogar', 'casa', 'arriendo', 'luz', 'agua', 'gas', 'internet', 'servicios', 'aseo', 'mercado del hogar'],
    'Salud': ['salud', 'medicina', 'medico', 'doctor', 'odontologia', 'farmacia', 'pastillas', 'cita'],
    'Educación': ['educacion', 'curso', 'colegio', 'universidad', 'clase', 'libro', 'capacitacion', 'estudio'],
    'Entretenimiento': ['entretenimiento', 'cine', 'salida', 'paseo', 'netflix', 'musica', 'diversion', 'juego'],
    'Ropa': ['ropa', 'zapatos', 'camiseta', 'pantalon', 'vestido'],
    'Tecnología': ['tecnologia', 'celular', 'computador', 'software', 'internet', 'app'],
    'Ahorro': ['ahorro', 'inversion', 'cdt', 'fondo', 'guardar plata'],
    'Ingreso': ['ingreso', 'sueldo', 'salario', 'pago', 'transferencia recibida', 'venta', 'cobro'],
    'Otros': ['otro', 'otros', 'varios', 'misc', 'miscelaneo'],
  };

  for (const [canonical, synonyms] of Object.entries(mapping)) {
    if (normalized === normalizeCategory(canonical)) return canonical;
    if (synonyms.some((s) => normalizeCategory(s) === normalized || normalized.includes(normalizeCategory(s)))) return canonical;
  }

  return 'Otros';
}

function canonicalAccountName(input: string, accounts: any[]): string {
  const normalized = normalizeText(input);

  const mapping: Record<string, string[]> = {
    'Efectivo': ['efectivo', 'cash', 'contado'],
    'Nequi': ['nequi', 'neq'],
    'Daviplata': ['daviplata', 'davi plata'],
    'Banco': ['banco', 'bancolombia', 'cuenta bancaria', 'transferencia bancaria'],
  };

  for (const [canonical, synonyms] of Object.entries(mapping)) {
    if (synonyms.some((s) => normalized.includes(normalizeText(s)))) {
      const found = accounts.find((a) => normalizeText(a.name) === normalizeText(canonical));
      if (found) return found.name;
    }
  }

  const exactMatch = accounts.find((a) => normalizeText(a.name) === normalized);
  if (exactMatch) return exactMatch.name;

  const cashAcc = accounts.find((a) => normalizeText(a.name) === 'efectivo');
  return cashAcc ? cashAcc.name : accounts.length > 0 ? accounts[0].name : 'Efectivo';
}

function normalizeAmountFromBot(amount: any): number {
  if (typeof amount === 'number') return amount;
  if (!amount) return 0;

  let str = String(amount).toLowerCase().trim();

  if (str.includes('mil') || str.includes('luca')) {
    const numPart = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!Number.isNaN(numPart)) return numPart * 1000;
  }

  if (str.endsWith('k')) {
    const numPart = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!Number.isNaN(numPart)) return numPart * 1000;
  }

  if (str.includes('millon')) {
    const numPart = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!Number.isNaN(numPart)) return numPart * 1000000;
  }

  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(/,/g, '.');
  } else if (str.includes('.')) {
    const parts = str.split('.');
    if (parts[parts.length - 1].length === 3) str = str.replace(/\./g, '');
  } else if (str.includes(',')) {
    str = str.replace(/,/g, '');
  }

  const finalNum = parseFloat(str.replace(/[^0-9.]/g, ''));
  return Number.isNaN(finalNum) ? 0 : finalNum;
}

function extractAmountFromText(message: string): number {
  const text = normalizeText(message);
  const moneyMatch = text.match(/(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*(mil|lucas?|k|millones?|millon)?/i);
  if (!moneyMatch) return 0;
  return normalizeAmountFromBot(`${moneyMatch[1]} ${moneyMatch[2] || ''}`.trim());
}

function inferTypeFromText(message: string): 'income' | 'expense' | null {
  const text = normalizeText(message);
  const expenseWords = ['me gaste', 'gaste', 'compre', 'pague', 'me toco pagar', 'se me fueron', 'inverti en', 'mande plata', 'saque plata', 'cancelé', 'cancele', 'abone', 'almorce', 'recargue', 'tanquie'];
  const incomeWords = ['me entro', 'entro plata', 'recibi', 'me pagaron', 'cobre', 'me consignaron', 'me depositaron', 'llego el sueldo', 'llego la quincena', 'me hicieron transferencia', 'vendi', 'me dieron', 'ingrese plata'];

  if (incomeWords.some((w) => text.includes(normalizeText(w)))) return 'income';
  if (expenseWords.some((w) => text.includes(normalizeText(w)))) return 'expense';
  return null;
}

function inferDescription(message: string): string {
  let clean = message
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '')
    .replace(/\b(me gaste|gast[eé]|compre|compr[eé]|pague|pagu[eé]|me pagaron|recibi|recib[ií]|cobre|cobr[eé]|en|por|con|de)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) clean = 'Movimiento registrado desde el chat';
  return clean.slice(0, 80);
}

function fallbackBotAction(message: string, hasImage: boolean): BotAction {
  const text = normalizeText(message);

  if (hasImage) {
    return {
      intent: 'clarify',
      replyToUser: 'No pude leer la imagen automáticamente en este momento. Escríbeme el valor y qué compraste o pagaste, y lo registro por ti.',
      confidence: 0.55,
      emotionalTone: 'neutral',
      suggestedNextQuestion: '¿Cuánto fue y en qué lo pagaste?',
    };
  }

  if (/^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey)\b/.test(text)) {
    return {
      intent: 'conversation_only',
      replyToUser: '¡Hola! Estoy listo para ayudarte con tus ingresos y gastos. Puedes escribirme algo como: “me gasté 10 mil en un helado” o preguntarme “¿cómo voy este mes?”.',
      confidence: 0.95,
      emotionalTone: 'encouraging',
      suggestedNextQuestion: '¿Quieres registrar un gasto o revisar tu resumen del mes?',
    };
  }

  if (text.includes('como voy') || text.includes('cuanto gaste') || text.includes('cuanto he gastado') || text.includes('resumen') || text.includes('balance')) {
    return {
      intent: 'query_summary',
      query: { range: 'this_month', metric: 'balance' },
      replyToUser: 'Claro, reviso tu resumen real de este mes.',
      confidence: 0.9,
      emotionalTone: 'neutral',
    };
  }

  if (text.includes('consejo') || text.includes('no me alcanza') || text.includes('preocupado') || text.includes('organizar')) {
    return {
      intent: 'financial_advice',
      replyToUser: 'Te entiendo. Vamos paso a paso: primero revisemos tus gastos principales y luego buscamos dónde ajustar sin sentirlo tan pesado.',
      confidence: 0.85,
      emotionalTone: 'calm',
    };
  }

  const type = inferTypeFromText(message);
  const amount = extractAmountFromText(message);
  if (type && amount > 0) {
    const description = inferDescription(message);
    return {
      intent: 'create_transaction',
      shouldCreateTransaction: true,
      transaction: {
        type,
        amount,
        currency: 'COP',
        category: type === 'income' ? 'Ingreso' : canonicalCategory(description),
        accountName: canonicalAccountName(message, []),
        description,
        date: text.includes('ayer') ? 'yesterday' : 'today',
      },
      replyToUser: type === 'income' ? `Listo, registré ese ingreso por $${amount.toLocaleString('es-CO')}.` : `Listo, registré ese gasto por $${amount.toLocaleString('es-CO')}.`,
      confidence: 0.82,
      emotionalTone: 'encouraging',
    };
  }

  return {
    intent: 'conversation_only',
    replyToUser: 'Te leo. Puedes hablarme natural: contarme un gasto, un ingreso, pedirme un resumen o preguntarme cómo organizar mejor tu plata.',
    confidence: 0.75,
    emotionalTone: 'calm',
    suggestedNextQuestion: '¿Quieres registrar algo o revisar cómo va el mes?',
  };
}

function extractJsonObject(content: string): string {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isLikelyImageError(error: any): boolean {
  const data = JSON.stringify(error?.response?.data || {}).toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const combined = `${data} ${message}`;
  return ['image', 'vision', 'multimodal', 'unsupported', 'invalid content', 'image_url'].some((term) => combined.includes(term));
}

async function getSummaryForUser(uid: string, range: string, category?: string): Promise<FinancialSummary> {
  const db = admin.firestore();
  let startDate = startOfMonth(new Date());
  let endDate = endOfMonth(new Date());

  if (range === 'today') startDate = startOfDay(new Date());
  if (range === 'last_3_days') startDate = subDays(startOfDay(new Date()), 2);
  if (range === 'last_7_days') startDate = subDays(startOfDay(new Date()), 6);

  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('transactions')
    .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
    .get();

  let txs = snap.docs.map((d) => d.data());

  if (category) {
    const normTarget = normalizeCategory(canonicalCategory(category));
    txs = txs.filter((t) => t.category && normalizeCategory(t.category) === normTarget);
  }

  const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const expenses = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);

  const cats: Record<string, number> = {};
  txs
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      const categoryName = t.category || 'Otros';
      cats[categoryName] = (cats[categoryName] || 0) + Number(t.amount || 0);
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
    generatedAt: new Date(),
  };
}

async function ensureDefaultAccounts(uid: string): Promise<any[]> {
  const db = admin.firestore();
  const accsCol = db.collection('users').doc(uid).collection('accounts');
  const existingAccs = await accsCol.get();

  if (!existingAccs.empty) {
    return existingAccs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const defaults = [
    { name: 'Efectivo', type: 'cash', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Nequi', type: 'nequi', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Daviplata', type: 'daviplata', initialBalance: 0, currentBalance: 0, active: true },
    { name: 'Banco', type: 'bank', initialBalance: 0, currentBalance: 0, active: true },
  ];

  const batch = db.batch();
  const created: any[] = [];
  defaults.forEach((acc) => {
    const ref = accsCol.doc();
    const data = {
      ...acc,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(ref, data);
    created.push({ id: ref.id, ...data });
  });

  await batch.commit();
  return created;
}

function serializeGeneratedAt(value: any): string {
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate) return value.toDate().toISOString();
  if (value) return String(value);
  return new Date().toISOString();
}

function sanitizeTransactionCreated(transactionCreated: any) {
  if (!transactionCreated) return null;

  return {
    id: transactionCreated.id,
    type: transactionCreated.type,
    amount: transactionCreated.amount,
    category: transactionCreated.category,
    description: transactionCreated.description,
    accountName: transactionCreated.accountName,
  };
}

function sanitizeSummaryData(summaryData: any) {
  if (!summaryData) return null;

  return {
    totalIncome: Number(summaryData.totalIncome || 0),
    totalExpenses: Number(summaryData.totalExpenses || 0),
    balance: Number(summaryData.balance || 0),
    byCategory: summaryData.byCategory || {},
    topCategory: summaryData.topCategory || null,
    transactionCount: Number(summaryData.transactionCount || 0),
    range: summaryData.range,
    generatedAt: serializeGeneratedAt(summaryData.generatedAt),
  };
}

async function callDeepSeek(
  userMessage: string,
  imageBase64: string | null,
  imageMimeType: string | null,
  context: string,
  chatHistory: any[],
  apiKey: string
): Promise<BotAction> {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is empty');

  const hasImage = Boolean(imageBase64 && imageMimeType);
  const systemPrompt = `
Eres el asistente financiero conversacional de "Ingresos y Egresos Hogar".
Hablas en español colombiano, con tono cercano, claro y tranquilo. No eres un bot de comandos: el usuario puede escribir con errores, frases incompletas o modismos.

OBJETIVO:
1. Conversar naturalmente.
2. Registrar gastos e ingresos cuando la intención sea clara.
3. Responder consultas financieras usando la intención adecuada; el sistema calculará las cifras reales.
4. Pedir aclaración cuando falten datos o no haya suficiente confianza.

REGLAS:
- Responde SIEMPRE como JSON estricto, sin markdown.
- intent debe ser: create_transaction, query_summary, analyze_behavior, financial_advice, update_transaction, delete_transaction, clarify o conversation_only.
- Para crear transacción necesitas tipo, monto y descripción clara.
- Si la confianza es menor a 0.75, usa clarify.
- No inventes saldos ni datos. Para resúmenes, devuelve query_summary y el sistema reemplaza la respuesta con datos reales.
- Si el usuario solo saluda o conversa, usa conversation_only y responde humano.

SINÓNIMOS DE GASTO:
me gasté, gasté, compré, pagué, me tocó pagar, se me fueron, invertí en, mandé plata para, saqué plata para, cancelé, aboné, hice mercado, tanquié, recargué, almorcé, pedí domicilio, pagué servicios.

SINÓNIMOS DE INGRESO:
me entró plata, recibí, me pagaron, cobré, me consignaron, me depositaron, llegó el sueldo, llegó la quincena, me hicieron transferencia, vendí, me dieron, ingresé plata.

IMÁGENES:
Si hay imagen, analiza solo texto visible. Extrae total final, fecha, comercio/persona, categoría, método de pago y tipo. Si no estás seguro, pregunta.
Si el modelo no puede procesar imagen, no inventes.

CATEGORÍAS:
Alimentación, Transporte, Hogar, Salud, Educación, Entretenimiento, Ropa, Tecnología, Ahorro, Ingreso, Otros.

EJEMPLOS:
Usuario: hola
JSON: {"intent":"conversation_only","replyToUser":"¡Hola! Estoy listo para ayudarte con tus ingresos y gastos.","confidence":0.95,"emotionalTone":"encouraging"}

Usuario: me gasté 10 mil en un helado
JSON: {"intent":"create_transaction","shouldCreateTransaction":true,"transaction":{"type":"expense","amount":10000,"currency":"COP","category":"Alimentación","accountName":"Efectivo","description":"helado","date":"today"},"confidence":0.95,"replyToUser":"¡Listo! Ya registré el gasto de 10.000 en helado."}

Usuario: cuánto gasté este mes
JSON: {"intent":"query_summary","query":{"range":"this_month","metric":"expenses"},"confidence":1,"replyToUser":"Claro, reviso tus gastos reales de este mes."}

CONTEXTO FINANCIERO REAL:
${context}

FECHA ACTUAL (Colombia): ${format(new Date(), 'yyyy-MM-dd HH:mm')}
`;

  const finalUserMessage = hasImage
    ? {
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        ],
      }
    : { role: 'user', content: userMessage };

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map((m) => ({
      role: m.sender === 'bot' ? 'assistant' : 'user',
      content: String(m.text || ''),
    })),
    finalUserMessage,
  ];

  try {
    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-v4-pro',
        messages,
        response_format: { type: 'json_object' },
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        temperature: 0.35,
        max_tokens: 8192,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: hasImage ? 45000 : 30000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty DeepSeek response');
    return JSON.parse(extractJsonObject(content)) as BotAction;
  } catch (error: any) {
    console.error('DeepSeek Error:', error.response?.data || error.message);
    if (hasImage && isLikelyImageError(error)) throw new Error('IMAGE_ANALYSIS_FAILED');
    throw error;
  }
}

export const chatWithBot = onCall({ ...PUBLIC_CALLABLE_OPTIONS, secrets: [DEEPSEEK_API_KEY] }, async (request) => {
  const { message, imageBase64, imageMimeType } = request.data || {};
  const hasImage = Boolean(imageBase64);

  console.log('chatWithBot start', {
    hasAuth: !!request.auth,
    uid: request.auth?.uid || null,
    hasMessage: typeof request.data?.message === 'string',
    hasImage,
  });

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tu sesión no está activa. Vuelve a iniciar sesión.');
  }

  if (!message || typeof message !== 'string') throw new HttpsError('invalid-argument', 'El mensaje es obligatorio.');

  const uid = request.auth.uid;
  const db = admin.firestore();
  const chatCol = db.collection('users').doc(uid).collection('chatMessages');

  if (hasImage) {
    if (typeof imageBase64 !== 'string' || typeof imageMimeType !== 'string' || !imageMimeType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'La imagen enviada no es válida.');
    }
    if (imageBase64.length > 5_500_000) {
      throw new HttpsError('invalid-argument', 'La imagen está muy pesada. Intenta con una foto más liviana.');
    }
  }

  try {
    const userMsgData: any = {
      text: message,
      sender: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (hasImage) userMsgData.hasImage = true;
    await chatCol.add(userMsgData);

    let accounts = await ensureDefaultAccounts(uid);
    if (!Array.isArray(accounts)) accounts = [];
    if (accounts.length === 0) {
      console.warn('ensureDefaultAccounts returned no accounts', { uid });
    }

    const [recentTxsSnap, chatHistorySnap] = await Promise.all([
      db.collection('users').doc(uid).collection('transactions').orderBy('date', 'desc').limit(10).get(),
      chatCol.orderBy('createdAt', 'desc').limit(13).get(),
    ]);

    const recentTxs = recentTxsSnap.docs.map((d) => {
      const data = d.data();
      return {
        desc: data.description || '',
        amt: Number(data.amount || 0),
        type: data.type || '',
        cat: data.category || '',
        date: data.date?.toDate ? data.date.toDate().toISOString() : null,
      };
    });

    const allHistory = chatHistorySnap.docs.reverse();
    const chatHistory = allHistory.length > 0 ? allHistory.slice(0, -1).map((d) => d.data()) : [];
    const monthlySummary = await getSummaryForUser(uid, 'this_month');

    const context = `Cuentas: ${accounts.map((a) => `${a.name} ($${Number(a.currentBalance || 0).toLocaleString('es-CO')})`).join(', ')}
Movimientos recientes: ${JSON.stringify(recentTxs)}
Resumen mes: Ingresos $${monthlySummary.totalIncome}, Gastos $${monthlySummary.totalExpenses}, Balance $${monthlySummary.balance}`;

    let botAction: BotAction;
    try {
      botAction = await callDeepSeek(
        message,
        hasImage ? imageBase64 : null,
        hasImage ? imageMimeType : null,
        context,
        chatHistory,
        DEEPSEEK_API_KEY.value()
      );
    } catch (error: any) {
      console.error('AI fallback activated:', error.message || error);
      botAction = fallbackBotAction(message, hasImage);
    }

    let transactionCreated: any = null;
    let summaryData: any = null;

    if (botAction.intent === 'create_transaction' && botAction.transaction && botAction.confidence >= 0.75) {
      const tx = botAction.transaction;
      const amount = normalizeAmountFromBot(tx.amount);
      const description = String(tx.description || inferDescription(message)).trim();
      const txType = tx.type === 'income' || tx.type === 'expense' ? tx.type : inferTypeFromText(message);
      const category = canonicalCategory(tx.category || description || 'Otros');
      const accountName = canonicalAccountName(tx.accountName || message || 'Efectivo', accounts);

      if (!Number.isFinite(amount) || amount <= 0 || !description || !txType) {
        botAction.replyToUser = 'No alcancé a identificar bien todos los detalles del movimiento. ¿Me dices el valor y en qué fue?';
        botAction.intent = 'clarify';
      } else {
        let account = accounts.find((a) => a.name === accountName);
        if (!account) account = accounts.find((a) => a.name === 'Efectivo') || accounts[0];

        if (!account?.id) {
          console.warn('No valid account found for chat transaction; retrying defaults', { uid, accountName });
          accounts = await ensureDefaultAccounts(uid);
          account = accounts.find((a) => a.name === accountName) || accounts.find((a) => a.name === 'Efectivo') || accounts[0];
        }

        if (!account?.id) {
          botAction.replyToUser = 'Puedo ayudarte con ese movimiento, pero no encontré una cuenta disponible para guardarlo. Revisa tus cuentas e inténtalo de nuevo.';
          botAction.intent = 'clarify';
          botAction.suggestedNextQuestion = '¿Quieres revisar tus cuentas?';
        } else {
          const batch = db.batch();
          const txRef = db.collection('users').doc(uid).collection('transactions').doc();
          const accRef = db.collection('users').doc(uid).collection('accounts').doc(account.id);

          batch.set(txRef, {
            type: txType,
            amount,
            category,
            description,
            accountId: account.id,
            accountName: account.name,
            currency: 'COP',
            source: 'bot',
            confidence: botAction.confidence,
            date: parseTransactionDate(tx.date),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rawText: message,
            wasFromImage: hasImage,
          });

          const balanceChange = txType === 'income' ? amount : -amount;
          batch.update(accRef, {
            currentBalance: admin.firestore.FieldValue.increment(balanceChange),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await batch.commit();
          const newDoc = await txRef.get();
          transactionCreated = { id: newDoc.id, ...newDoc.data() };
        }
      }
    }

    if (botAction.intent === 'query_summary' && botAction.query) {
      const range = botAction.query.range || 'this_month';
      const cat = botAction.query.category ? canonicalCategory(botAction.query.category) : undefined;
      summaryData = await getSummaryForUser(uid, range, cat);

      if (cat) {
        botAction.replyToUser = `En ${cat} llevas gastados $${summaryData.totalExpenses.toLocaleString('es-CO')} en lo que va de ${range === 'this_month' ? 'el mes' : range}.`;
      } else {
        botAction.replyToUser = `Listo, en ${range === 'this_month' ? 'este mes' : range} llevas $${summaryData.totalExpenses.toLocaleString('es-CO')} en gastos y $${summaryData.totalIncome.toLocaleString('es-CO')} en ingresos. Tu balance neto es de $${summaryData.balance.toLocaleString('es-CO')}.`;
      }
    }

    if (botAction.intent === 'analyze_behavior') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      if (summaryData.transactionCount === 0) {
        botAction.replyToUser = 'Todavía no tengo suficientes datos para analizar tu comportamiento. Registra algunos gastos o ingresos y te ayudo a ver patrones.';
      } else {
        const avg = Math.round(summaryData.totalExpenses / Math.max(1, new Date().getDate()));
        const isOverspending = summaryData.totalExpenses > summaryData.totalIncome;
        botAction.replyToUser = `He analizado tus movimientos. Llevas un gasto promedio aproximado de $${avg.toLocaleString('es-CO')} al día. ${isOverspending ? 'Tus gastos están superando tus ingresos este mes.' : 'Vas con balance positivo este mes.'}`;
      }
    }

    if (botAction.intent === 'financial_advice') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      botAction.replyToUser = 'Mi consejo: registra todo por unos días, especialmente gastos pequeños. Ahí veremos con datos reales dónde ajustar sin complicarte.';
      if (summaryData.topCategory) botAction.replyToUser += ` Por ahora, tu mayor gasto es ${summaryData.topCategory.name}.`;
    }

    if (botAction.intent === 'update_transaction' || botAction.intent === 'delete_transaction') {
      botAction.replyToUser = "Por ahora no puedo editar o borrar movimientos directamente desde el chat. Hazlo desde la pestaña de 'Movimientos'.";
      botAction.intent = 'clarify';
    }

    const safeTransactionCreated = sanitizeTransactionCreated(transactionCreated);
    const safeSummary = sanitizeSummaryData(summaryData);

    const botMsg: any = {
      text: botAction.replyToUser,
      sender: 'bot',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      intent: botAction.intent,
      emotionalTone: botAction.emotionalTone || 'neutral',
      suggestedNextQuestion: botAction.suggestedNextQuestion || '',
    };
    if (transactionCreated) botMsg.transactionId = transactionCreated.id;
    if (safeSummary) botMsg.summary = safeSummary;
    await chatCol.add(botMsg);

    return {
      replyToUser: botAction.replyToUser,
      intent: botAction.intent,
      emotionalTone: botAction.emotionalTone || 'neutral',
      suggestedNextQuestion: botAction.suggestedNextQuestion || '',
      transactionCreated: safeTransactionCreated,
      summary: safeSummary,
    };
  } catch (error: any) {
    console.error('Chat Error Full:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
      details: error?.details,
    });
    const friendly = 'Tuve un problema técnico al procesar eso, pero ya recibí tu mensaje. Intenta nuevamente en unos segundos.';
    try {
      await chatCol.add({
        text: friendly,
        sender: 'bot',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        intent: 'clarify',
        emotionalTone: 'calm',
      });
    } catch (writeError) {
      console.error('Could not write fallback bot message:', writeError);
    }
    return {
      replyToUser: friendly,
      intent: 'clarify' as BotIntent,
      emotionalTone: 'calm',
      suggestedNextQuestion: '¿Quieres intentarlo otra vez?',
    };
  }
});

export const getFinancialSummary = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  const { range, category } = request.data || {};
  return await getSummaryForUser(request.auth.uid, range || 'this_month', category ? canonicalCategory(category) : undefined);
});

export const seedDefaultUserData = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticación requerida.');
  await ensureDefaultAccounts(request.auth.uid);
  return { success: true };
});
