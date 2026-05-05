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

function canonicalCategory(input: string): string {
  const normalized = normalizeCategory(input);
  
  const mapping: Record<string, string[]> = {
    'Alimentación': ['comida', 'mercado', 'supermercado', 'almuerzo', 'desayuno', 'cena', 'restaurante', 'domicilio', 'rappi', 'helado', 'cafe', 'panaderia', 'tienda'],
    'Transporte': ['bus', 'taxi', 'uber', 'didi', 'gasolina', 'parqueadero', 'pasaje', 'moto', 'transporte', 'peaje'],
    'Hogar': ['arriendo', 'luz', 'agua', 'gas', 'internet', 'servicios', 'aseo', 'hogar', 'casa', 'mercado del hogar'],
    'Salud': ['medicina', 'medico', 'doctor', 'odontologia', 'farmacia', 'pastillas', 'cita', 'salud'],
    'Educación': ['curso', 'colegio', 'universidad', 'clase', 'libro', 'capacitacion', 'estudio'],
    'Entretenimiento': ['cine', 'salida', 'paseo', 'netflix', 'musica', 'diversion', 'juego'],
    'Ropa': ['ropa', 'zapatos', 'camiseta', 'pantalon', 'vestido'],
    'Tecnología': ['celular', 'computador', 'software', 'internet', 'app'],
    'Ahorro': ['ahorro', 'inversion', 'cdt', 'fondo', 'guardar plata'],
    'Ingreso': ['sueldo', 'salario', 'pago', 'transferencia recibida', 'venta', 'cobro', 'ingreso']
  };

  for (const [canonical, synonyms] of Object.entries(mapping)) {
    if (normalized === normalizeCategory(canonical)) return canonical;
    if (synonyms.some(s => normalizeCategory(s) === normalized)) return canonical;
  }

  // Si no encaja, capitalizar la primera letra o devolver 'Otros'
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase() || 'Otros';
}

function canonicalAccountName(input: string, accounts: any[]): string {
  const normalized = normalizeCategory(input);
  
  const mapping: Record<string, string[]> = {
    'Efectivo': ['efectivo', 'cash', 'contado'],
    'Nequi': ['nequi', 'neq', 'nequi app'],
    'Daviplata': ['daviplata', 'davi plata', 'daviplata app'],
    'Banco': ['banco', 'bancolombia', 'cuenta bancaria', 'transferencia bancaria']
  };

  for (const [canonical, synonyms] of Object.entries(mapping)) {
    if (synonyms.some(s => normalizeCategory(s) === normalized)) {
      // Verificar si el usuario tiene una cuenta con ese nombre canónico
      const found = accounts.find(a => normalizeCategory(a.name) === normalizeCategory(canonical));
      if (found) return found.name;
    }
  }

  // Si no encuentra por sinónimo, buscar coincidencia exacta
  const exactMatch = accounts.find(a => normalizeCategory(a.name) === normalized);
  if (exactMatch) return exactMatch.name;

  // Default: Efectivo o la primera disponible
  const cashAcc = accounts.find(a => normalizeCategory(a.name) === 'efectivo');
  return cashAcc ? cashAcc.name : (accounts.length > 0 ? accounts[0].name : 'Efectivo');
}

function normalizeAmountFromBot(amount: any): number {
  if (typeof amount === 'number') return amount;
  if (!amount) return 0;

  let str = String(amount).toLowerCase().trim();
  
  // Manejar "mil" (ej: "10 mil" -> 10000)
  if (str.includes('mil')) {
    const numPart = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(numPart)) return numPart * 1000;
  }
  
  // Manejar "lucas" (ej: "50 lucas" -> 50000)
  if (str.includes('luca')) {
    const numPart = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(numPart)) return numPart * 1000;
  }

  // Manejar "k" (ej: "20k" -> 20000)
  if (str.endsWith('k')) {
    const numPart = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(numPart)) return numPart * 1000;
  }

  // Manejar "millon" o "millones"
  if (str.includes('millon')) {
    const numPart = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(numPart)) return numPart * 1000000;
  }

  // Limpiar puntos y comas de formato estándar (10.000 o 10,000)
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(/,/g, '.');
  } else if (str.includes('.')) {
    const parts = str.split('.');
    if (parts[parts.length - 1].length === 3) {
      str = str.replace(/\./g, '');
    }
  } else if (str.includes(',')) {
    str = str.replace(/,/g, '');
  }

  const finalNum = parseFloat(str.replace(/[^0-9.]/g, ''));
  return isNaN(finalNum) ? 0 : finalNum;
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

async function callDeepSeek(
  userMessage: string, 
  imageBase64: string | null, 
  imageMimeType: string | null, 
  context: string, 
  chatHistory: any[], 
  apiKey: string
): Promise<BotAction> {
  const systemPrompt = `
Eres un asistente financiero personal familiar para la app "Ingresos y Egresos Hogar". 
Tu trabajo es ayudar al usuario a entender, registrar y organizar su dinero de forma sencilla y empática.

COMPRENSIÓN DE LENGUAJE NATURAL:
No eres un bot de comandos. Eres un asistente conversacional financiero familiar. El usuario puede hablar de forma informal, incompleta, con errores de escritura, con modismos colombianos o con frases largas. Tu trabajo es interpretar la intención real.

SOPORTE MULTIMODAL (IMÁGENES):
Si el usuario envía una imagen (recibo, factura, pantallazo), analízala cuidadosamente.
- Extrae el monto total, la descripción del servicio/producto y la fecha si es visible.
- Si es un recibo de servicios públicos (agua, luz, gas, internet), la categoría es "Hogar".
- Si es un recibo de restaurante o mercado, la categoría es "Alimentación".
- Si no estás seguro del monto o categoría tras ver la imagen, pregunta amablemente.

SINÓNIMOS Y EJEMPLOS DE GASTO (EXPENSE):
Entiende como gasto frases como: me gasté, gasté, compré, pagué, me tocó pagar, se me fueron, invertí en, puse plata para, mandé plata para, saqué plata para, compramos, pagamos, pagué con Nequi, pagué en efectivo, pasé plata para, cancelé, aboné, hice mercado, tanquié, recargué, compré comida, almorcé, pedí domicilio, pagué servicios, pagué arriendo, pagué internet, pagué luz, pagué agua, pagué gas.
Regla: Si detectas salida de dinero desde el usuario o su hogar, normalmente es expense.

SINÓNIMOS Y EJEMPLOS DE INGRESO (INCOME):
Entiende como ingreso frases como: me entró plata, entró plata, recibí, me pagaron, cobré, me consignaron, me depositaron, llegó el sueldo, llegó la quincena, me hicieron transferencia, vendí algo, me dieron, recibimos, ingresé plata, puse ingreso, entró a Nequi, entró a Daviplata, me llegó por banco, me pagaron una deuda.
Regla: Si detectas entrada de dinero al usuario o al hogar, normalmente es income.

FEW-SHOT EXAMPLES:

Usuario: "me gasté 10 mil en un helado"
Respuesta JSON: { "intent": "create_transaction", "transaction": { "type": "expense", "amount": 10000, "category": "Alimentación", "accountName": "Efectivo", "description": "helado", "date": "today" }, "confidence": 0.95, "replyToUser": "¡Qué rico un helado! Ya anoté los 10.000 en alimentación." }

Usuario: [IMAGEN DE RECIBO DE GAS POR 45.000] "pagué esto"
Respuesta JSON: { "intent": "create_transaction", "transaction": { "type": "expense", "amount": 45000, "category": "Hogar", "accountName": "Efectivo", "description": "servicio de gas (según imagen)", "date": "today" }, "confidence": 0.98, "replyToUser": "Listo, ya registré el pago de gas por 45.000 que aparece en la imagen." }

Usuario: "compré mercado por 120.000 con nequi"
Respuesta JSON: { "intent": "create_transaction", "transaction": { "type": "expense", "amount": 120000, "category": "Alimentación", "accountName": "Nequi", "description": "mercado", "date": "today" }, "confidence": 0.98, "replyToUser": "Listo, guardé el mercado por 120.000 pagado con Nequi." }

Usuario: "me pagaron 800.000 del trabajo"
Respuesta JSON: { "intent": "create_transaction", "transaction": { "type": "income", "amount": 800000, "category": "Ingreso", "accountName": "Efectivo", "description": "pago del trabajo", "date": "today" }, "confidence": 0.92, "replyToUser": "¡Excelente! Ya registré tu pago de 800.000." }

Usuario: "ayer pagué 5000 de bus"
Respuesta JSON: { "intent": "create_transaction", "transaction": { "type": "expense", "amount": 5000, "category": "Transporte", "accountName": "Efectivo", "description": "pasaje de bus", "date": "yesterday" }, "confidence": 0.95, "replyToUser": "Anotado lo del bus de ayer." }

Usuario: "cómo voy este mes"
Respuesta JSON: { "intent": "query_summary", "query": { "range": "this_month", "metric": "balance" }, "confidence": 1.0, "replyToUser": "Claro, déjame ver cómo van tus cuentas este mes..." }

REGLAS DE OPERACIÓN:
- Responde SIEMPRE en formato JSON estricto.
- "intent" debe ser uno de: create_transaction, query_summary, analyze_behavior, financial_advice, update_transaction, delete_transaction, clarify, conversation_only.
- "replyToUser" es tu respuesta humana.
- "shouldCreateTransaction" es true solo si tienes: Tipo (gasto/ingreso), Monto y Descripción clara.
- Si falta información o la confianza es baja (< 0.75), usa "intent": "clarify" y pregunta amablemente.
- NO INVENTES DATOS. Para consultas de saldos o gastos, el sistema proveerá la respuesta real basada en el intent.
- Si el usuario habla de temas no financieros, responde normal y humano. Puedes conectar suavemente con la organización financiera si tiene sentido.
- Categorías oficiales: Alimentación, Transporte, Hogar, Salud, Educación, Entretenimiento, Ropa, Tecnología, Ahorro, Ingreso, Otros.

CONTEXTO FINANCIERO ACTUAL:
${context}

FECHA ACTUAL (Colombia): ${format(new Date(), 'yyyy-MM-dd HH:mm')}
`;

  // Construir el contenido del mensaje del usuario (Multimodal)
  const userContent: any[] = [{ type: 'text', text: userMessage }];
  if (imageBase64 && imageMimeType) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${imageMimeType};base64,${imageBase64}`
      }
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(m => ({
      role: m.sender === 'bot' ? 'assistant' : 'user',
      content: m.text
    })),
    { role: 'user', content: userContent }
  ];

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat', // Nota: Si DeepSeek habilita un modelo de visión específico, cámbialo aquí.
        messages: messages,
        response_format: { type: 'json_object' },
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000 // Aumentamos timeout para procesamiento de imagen
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
    return result as BotAction;
  } catch (error: any) {
    console.error('DeepSeek Error:', error.response?.data || error.message);
    throw new HttpsError('internal', 'Error comunicándose con la IA.');
  }
}

// ── Callable Functions ─────────────────────────────────────────────────────

export const chatWithBot = onCall({ secrets: [DEEPSEEK_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'El usuario debe estar autenticado.');
  }

  const { message, imageBase64, imageMimeType } = request.data;
  if (!message || typeof message !== 'string') {
    throw new HttpsError('invalid-argument', 'El mensaje es obligatorio.');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const chatCol = db.collection('users').doc(uid).collection('chatMessages');

  try {
    // 1. Guardar mensaje del usuario inmediatamente
    const userMsgData: any = {
      text: message,
      sender: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // No guardamos la base64 en Firestore por espacio, pero indicamos que hubo imagen
    if (imageBase64) {
      userMsgData.hasImage = true;
    }

    await chatCol.add(userMsgData);

    // 2. Obtener contexto (Cuentas, Transacciones recientes, Historial de chat)
    const [accountsSnap, recentTxsSnap, chatHistorySnap] = await Promise.all([
      db.collection('users').doc(uid).collection('accounts').get(),
      db.collection('users').doc(uid).collection('transactions').orderBy('date', 'desc').limit(10).get(),
      chatCol.orderBy('createdAt', 'desc').limit(13).get()
    ]);

    let accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    const recentTxs = recentTxsSnap.docs.map(d => ({
      desc: d.data().description,
      amt: d.data().amount,
      type: d.data().type,
      cat: d.data().category,
      date: d.data().date.toDate().toISOString()
    }));
    
    const allHistory = chatHistorySnap.docs.reverse();
    const chatHistory = allHistory.length > 0 ? allHistory.slice(0, -1).map(d => d.data()) : [];

    // 3. Resumen del mes actual para contexto IA
    const monthlySummary = await getSummaryForUser(uid, 'this_month');
    
    const context = `
    Cuentas: ${accounts.map(a => `${a.name} ($${a.currentBalance})`).join(', ')}
    Movimientos recientes: ${JSON.stringify(recentTxs)}
    Resumen mes: Ingresos $${monthlySummary.totalIncome}, Gastos $${monthlySummary.totalExpenses}, Balance $${monthlySummary.balance}
    `;

    // 4. Llamar a la IA (Pasando la imagen si existe)
    const botAction = await callDeepSeek(
      message, 
      imageBase64 || null, 
      imageMimeType || null, 
      context, 
      chatHistory, 
      DEEPSEEK_API_KEY.value()
    );

    // 5. Ejecutar acciones basadas en la intención
    let transactionCreated = null;
    let summaryData: any = null;

    if (botAction.intent === 'create_transaction' && accounts.length === 0) {
      accounts = await ensureDefaultAccounts(uid);
    }

    if (botAction.intent === 'create_transaction' && botAction.transaction && botAction.confidence >= 0.75) {
      const tx = botAction.transaction;
      const amount = normalizeAmountFromBot(tx.amount);
      const category = canonicalCategory(tx.category || 'Otros');
      const accountName = canonicalAccountName(tx.accountName || 'Efectivo', accounts);

      if (amount <= 0 || !tx.description || !tx.type) {
        botAction.replyToUser = "No alcancé a identificar bien todos los detalles del movimiento (monto, tipo o descripción). ¿Podrías aclarármelo?";
        botAction.intent = 'clarify';
      } else {
        let account = accounts.find(a => a.name === accountName);
        if (!account) account = accounts.find(a => a.name === 'Efectivo') || accounts[0];

        if (account) {
          const batch = db.batch();
          const txRef = db.collection('users').doc(uid).collection('transactions').doc();
          const accRef = db.collection('users').doc(uid).collection('accounts').doc(account.id);

          batch.set(txRef, {
            type: tx.type,
            amount: amount,
            category: category,
            description: tx.description,
            accountId: account.id,
            accountName: account.name,
            currency: 'COP',
            source: 'bot',
            confidence: botAction.confidence,
            date: parseTransactionDate(tx.date),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rawText: message,
            wasFromImage: !!imageBase64
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
          botAction.replyToUser = "Lo siento, no pude encontrar una cuenta para registrar el movimiento.";
          botAction.intent = 'clarify';
        }
      }
    }

    if (botAction.intent === 'query_summary' && botAction.query) {
      const range = botAction.query.range || 'this_month';
      const cat = botAction.query.category;
      summaryData = await getSummaryForUser(uid, range, cat);

      if (cat) {
        const catSpent = summaryData.totalExpenses;
        botAction.replyToUser = `En ${cat} llevas gastados $${catSpent.toLocaleString('es-CO')} en lo que va de ${range === 'this_month' ? 'el mes' : range}.`;
      } else {
        botAction.replyToUser = `Listo, en ${range === 'this_month' ? 'este mes' : range} llevas $${summaryData.totalExpenses.toLocaleString('es-CO')} en gastos y $${summaryData.totalIncome.toLocaleString('es-CO')} en ingresos. Tu balance neto es de $${summaryData.balance.toLocaleString('es-CO')}.`;
      }
    }

    if (botAction.intent === 'analyze_behavior') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      if (summaryData.transactionCount === 0) {
        botAction.replyToUser = "Todavía no tengo suficientes datos para analizar tu comportamiento.";
      } else {
        const isOverspending = summaryData.totalExpenses > summaryData.totalIncome;
        botAction.replyToUser = `He analizado tus movimientos. Llevas un gasto promedio de $${Math.round(summaryData.totalExpenses / 30).toLocaleString('es-CO')} al día. `;
        if (isOverspending) {
          botAction.replyToUser += "Tus gastos están superando tus ingresos este mes.";
        } else {
          botAction.replyToUser += "Vas por buen camino con un balance positivo!";
        }
      }
    }

    if (botAction.intent === 'financial_advice') {
      summaryData = await getSummaryForUser(uid, 'this_month');
      botAction.replyToUser = "Mi consejo hoy es que intentes reducir un 10% tus gastos hormiga. ";
      if (summaryData.topCategory) {
        botAction.replyToUser += `Especialmente en ${summaryData.topCategory.name}, que es donde más se te va el dinero.`;
      }
    }

    if (botAction.intent === 'update_transaction' || botAction.intent === 'delete_transaction') {
      botAction.replyToUser = "Por ahora no puedo editar o borrar movimientos directamente desde el chat. Hazlo desde la pestaña de 'Movimientos'.";
      botAction.intent = 'clarify';
    }

    // 6. Guardar respuesta del bot
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
    await chatCol.add({
      text: "Tuve un problema técnico al procesar eso. ¿Me lo puedes repetir?",
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

