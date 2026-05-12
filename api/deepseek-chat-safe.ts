declare const process: {
  env: Record<string, string | undefined>;
};

type FastTransactionType = 'income' | 'expense';
type RiskLevel = 'low' | 'medium' | 'high';

type LocalAction = {
  intent: string;
  replyToUser: string;
  confidence: number;
  assistantMode: string;
  riskLevel: RiskLevel;
  emotionalTone: string;
  insights: Array<{ title: string; detail: string; severity: RiskLevel }>;
  suggestedActions: string[];
  suggestedNextQuestion: string;
  memoryPatch: Record<string, unknown>;
  transaction?: Record<string, unknown>;
};

type ParsedAccount = {
  name: string;
  normalized: string;
  words: string[];
  isBuiltin: boolean;
};

type AccountResolution =
  | { status: 'matched'; accountName: string; reason: string }
  | { status: 'ambiguous'; options: string[]; reason: string }
  | { status: 'missing'; options: string[]; reason: string };

const BUILTIN_ACCOUNTS = new Set(['efectivo', 'nequi', 'daviplata', 'davi plata', 'banco']);
const STOP_WORDS = new Set(['cuenta', 'cuentas', 'de', 'del', 'la', 'el', 'los', 'las', 'mi', 'mis', 'a', 'al', 'en', 'por', 'para', 'pesos', 'peso', 'hoy', 'ayer', 'manana', 'mañana']);

function normalizePlainText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholePhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(phrase)}(\\s|$)`, 'i').test(text);
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

function getBearerToken(req: any): string | null {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function safeHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).map((m) => ({
    role: m?.sender === 'bot' ? 'assistant' : 'user',
    content: String(m?.text || '').slice(0, 1200),
  }));
}

function localAction(replyToUser: string, mode = 'conversacion', suggestedActions: string[] = [], riskLevel: RiskLevel = 'low'): LocalAction {
  return {
    intent: mode === 'registro' && riskLevel !== 'low' ? 'clarify' : 'conversation_only',
    replyToUser,
    confidence: 0.99,
    assistantMode: mode,
    riskLevel,
    emotionalTone: riskLevel === 'high' ? 'alert' : 'friendly',
    insights: [],
    suggestedActions,
    suggestedNextQuestion: '',
    memoryPatch: {},
  };
}

function parseSimpleAmount(value: string): number {
  const text = normalizePlainText(value);
  const match = text.match(/(?:\$\s*)?(\d+(?:[.,]\d+)?)\s*(mil|lucas?|k|millones?|millon)?/i);
  if (!match) return 0;
  const base = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(base)) return 0;
  const scale = match[2] || '';
  if (scale.startsWith('mil') || scale.startsWith('luca') || scale === 'k') return Math.round(base * 1000);
  if (scale.startsWith('millon')) return Math.round(base * 1000000);
  return Math.round(base);
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasWholePhrase(text, normalizePlainText(phrase)));
}

function inferSimpleType(message: string): FastTransactionType | null {
  const text = normalizePlainText(message);
  const incomePhrases = [
    'me pagaron', 'me pago', 'me ingreso', 'me ingresaron', 'me consignaron', 'me depositaron', 'me transfirieron',
    'me enviaron', 'me dieron', 'me llego', 'me entro', 'me entraron', 'recibi', 'cobre', 'cobro', 'vendi', 'venta',
    'sueldo', 'salario', 'quincena', 'honorarios', 'ingrese', 'ingresa', 'ingreso', 'entraron', 'consignaron',
    'depositaron', 'transferencia recibida', 'recibi pago', 'pago recibido',
  ];
  const expensePhrases = [
    'gaste', 'me gaste', 'gasto', 'pague', 'pagar', 'pago', 'compre', 'compra', 'me compre', 'compramos',
    'pedi', 'pague por', 'pague en', 'acabe de pagar', 'acabo de pagar', 'me toco pagar', 'almorce', 'cene',
    'desayune', 'recargue', 'tanquie', 'saque para', 'inverti en', 'compre una', 'compre un', 'compre el',
  ];
  if (hasAnyPhrase(text, incomePhrases)) return 'income';
  if (hasAnyPhrase(text, expensePhrases)) return 'expense';
  return null;
}

function isComplexOrDangerous(message: string): boolean {
  const text = normalizePlainText(message);
  const blocked = [
    'borra', 'borrar', 'elimina', 'eliminar', 'quita', 'quitar', 'corrige', 'corregir', 'cambia', 'modifica',
    'actualiza', 'duplicado', 'duplicados', 'limpia', 'limpiar', 'deuda', 'debo', 'me debe', 'prestamo', 'preste',
    'abona', 'abono', 'pago deuda', 'analiza', 'analizar', 'como voy', 'reporte', 'plan', 'presupuesto', 'codigo',
    'html', 'css', 'react', 'javascript', 'typescript', 'prompt', 'explica', 'explicame', 'por que', 'porque',
    'imagen', 'foto', 'excel', 'importa', 'importar', 'resumen', 'diagnostico', 'consejo', 'recomienda',
  ];
  return blocked.some((word) => text.includes(word));
}

function inferSimpleCategory(message: string, type: FastTransactionType): string {
  if (type === 'income') return 'Ingreso';
  const text = normalizePlainText(message);
  if (['hamburguesa', 'papita', 'papas', 'helado', 'comida', 'mercado', 'cafe', 'almuerzo', 'restaurante', 'tienda', 'pan', 'gaseosa', 'perro caliente', 'arepa', 'empanada', 'pizza'].some((word) => text.includes(word))) return 'Alimentacion';
  if (['bus', 'taxi', 'uber', 'gasolina', 'transporte', 'pasaje', 'moto', 'carro', 'parqueadero', 'peaje'].some((word) => text.includes(word))) return 'Transporte';
  if (['arriendo', 'luz', 'agua', 'gas', 'internet', 'hogar', 'servicio', 'aseo'].some((word) => text.includes(word))) return 'Hogar';
  if (['medicina', 'farmacia', 'salud', 'doctor', 'cita medica', 'odontologia'].some((word) => text.includes(word))) return 'Salud';
  if (['ropa', 'zapatos', 'camisa', 'pantalon'].some((word) => text.includes(word))) return 'Ropa';
  if (['cine', 'netflix', 'spotify', 'juego', 'salida', 'rumba'].some((word) => text.includes(word))) return 'Entretenimiento';
  return 'Otros';
}

function inferSimpleDescription(message: string, type: FastTransactionType): string {
  const description = String(message || '')
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(mil|lucas?|k|millones?|millon)?/gi, '')
    .replace(/\b(me gaste|gast[eé]|gasto|compre|compr[eé]|compra|pedi|ped[ií]|pague|pagu[eé]|pago|pagar|acabe de pagar|acabo de pagar|me toco pagar|ingresa|ingrese|ingreso|me entro|entro|entraron|recibi|recib[ií]|me pagaron|me pago|cobre|cobr[eé]|vendi|venta|por|en|de|con|una|un|la|el|los|las)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (description) return description.charAt(0).toUpperCase() + description.slice(1);
  return type === 'income' ? 'Ingreso registrado desde el chat' : 'Gasto registrado desde el chat';
}

function parseAccountsFromContext(context: unknown): ParsedAccount[] {
  const text = String(context || '');
  const line = text.match(/Cuentas:\s*([^\n]+)/i)?.[1] || '';
  if (!line || /sin cuentas/i.test(line)) return [];
  return line
    .split(/\),\s*/)
    .map((part) => part.replace(/\)$/, '').trim())
    .map((part) => {
      const idx = part.lastIndexOf('(');
      const name = (idx >= 0 ? part.slice(0, idx) : part).trim();
      const normalized = normalizePlainText(name);
      const words = normalized.split(' ').filter((word) => word && !STOP_WORDS.has(word));
      return { name, normalized, words, isBuiltin: BUILTIN_ACCOUNTS.has(normalized) };
    })
    .filter((account) => account.name && account.normalized);
}

function uniqueByName(accounts: ParsedAccount[]): ParsedAccount[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    if (seen.has(account.normalized)) return false;
    seen.add(account.normalized);
    return true;
  });
}

function resolveAccountForTransaction(rawUserMessage: string, botAccountName: string | undefined, accounts: ParsedAccount[]): AccountResolution {
  const options = accounts.map((account) => account.name);
  if (!accounts.length) return { status: 'missing', options, reason: 'No hay cuentas disponibles en el contexto.' };

  const text = normalizePlainText(rawUserMessage);
  const botNorm = normalizePlainText(botAccountName || '');

  const exactInMessage = accounts.filter((account) => hasWholePhrase(text, account.normalized));
  if (exactInMessage.length === 1) return { status: 'matched', accountName: exactInMessage[0].name, reason: 'Nombre exacto mencionado por el usuario.' };
  if (exactInMessage.length > 1) {
    const ordered = [...exactInMessage].sort((a, b) => b.normalized.length - a.normalized.length);
    if (ordered[0].normalized.length > ordered[1].normalized.length) return { status: 'matched', accountName: ordered[0].name, reason: 'Nombre especifico mas largo mencionado.' };
    return { status: 'ambiguous', options: exactInMessage.map((account) => account.name), reason: 'Varias cuentas coinciden por nombre exacto.' };
  }

  const customMatches = accounts
    .filter((account) => !account.isBuiltin)
    .map((account) => ({ account, score: account.words.filter((word) => word.length >= 3 && hasWholePhrase(text, word)).length }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.account.normalized.length - a.account.normalized.length);
  if (customMatches.length === 1 || (customMatches.length > 1 && customMatches[0].score > customMatches[1].score)) {
    return { status: 'matched', accountName: customMatches[0].account.name, reason: 'Cuenta personalizada detectada por palabras clave.' };
  }
  if (customMatches.length > 1 && customMatches[0].score === customMatches[1].score) {
    return { status: 'ambiguous', options: uniqueByName(customMatches.map((m) => m.account)).map((a) => a.name), reason: 'Varias cuentas personalizadas coinciden.' };
  }

  const aliasChecks: Array<{ aliases: string[]; canonical: string }> = [
    { aliases: ['nequi'], canonical: 'nequi' },
    { aliases: ['daviplata', 'davi plata'], canonical: 'daviplata' },
    { aliases: ['efectivo'], canonical: 'efectivo' },
    { aliases: ['banco'], canonical: 'banco' },
  ];
  for (const check of aliasChecks) {
    if (check.aliases.some((alias) => hasWholePhrase(text, alias))) {
      const matches = accounts.filter((account) => account.normalized === check.canonical);
      if (matches.length === 1) return { status: 'matched', accountName: matches[0].name, reason: `Alias ${check.canonical} mencionado.` };
      if (matches.length > 1) return { status: 'ambiguous', options: matches.map((account) => account.name), reason: `Alias ${check.canonical} coincide con varias cuentas.` };
      return { status: 'missing', options, reason: `El usuario menciono ${check.canonical}, pero no existe esa cuenta.` };
    }
  }

  const botExact = accounts.find((account) => account.normalized === botNorm);
  if (botExact) return { status: 'matched', accountName: botExact.name, reason: 'Cuenta exacta propuesta por el modelo y validada contra cuentas reales.' };

  if (/\b(cuenta|banco|nequi|daviplata|davi plata|efectivo)\b/.test(text)) {
    return { status: 'missing', options, reason: 'El usuario menciono una cuenta, pero no coincide con ninguna cuenta existente.' };
  }

  if (accounts.length === 1) return { status: 'matched', accountName: accounts[0].name, reason: 'Solo existe una cuenta disponible.' };
  return { status: 'missing', options, reason: 'No hay cuenta clara en el mensaje. No se usa ninguna cuenta por defecto para evitar errores contables.' };
}

function accountClarificationAction(resolution: AccountResolution): LocalAction {
  const accountList = resolution.options.length ? resolution.options.join(', ') : 'no hay cuentas creadas';
  return {
    ...localAction(`Para no registrar mal la plata, necesito que me confirmes la cuenta exacta. Cuentas disponibles: ${accountList}.`, 'registro', resolution.options, 'medium'),
    intent: 'clarify',
    insights: [{ title: 'Cuenta no confirmada', detail: resolution.reason, severity: 'medium' }],
  };
}

function buildFastTransactionAction(message: string, context: unknown): LocalAction | null {
  if (isComplexOrDangerous(message)) return null;
  const amount = parseSimpleAmount(message);
  const type = inferSimpleType(message);
  if (!type || amount <= 0) return null;

  const accounts = parseAccountsFromContext(context);
  const resolution = resolveAccountForTransaction(message, undefined, accounts);
  if (resolution.status !== 'matched') return accountClarificationAction(resolution);

  const category = inferSimpleCategory(message, type);
  const accountName = resolution.accountName;
  const description = inferSimpleDescription(message, type);
  const verb = type === 'income' ? 'ingreso' : 'gasto';
  return {
    intent: 'create_transaction',
    replyToUser: `Listo, registre ${type === 'income' ? 'un' : 'el'} ${verb} de $${amount.toLocaleString('es-CO')} en ${accountName}${description ? ` (${description})` : ''}.`,
    confidence: 0.99,
    assistantMode: 'registro',
    riskLevel: 'low',
    emotionalTone: 'encouraging',
    transaction: { type, amount, currency: 'COP', category, accountName, description, date: 'today' },
    insights: [{ title: 'Cuenta validada', detail: `Use ${accountName}. ${resolution.reason}`, severity: 'low' }],
    suggestedActions: [],
    suggestedNextQuestion: '',
    memoryPatch: {},
  };
}

function buildCheapLocalConversation(message: string, hasImage: boolean): LocalAction | null {
  const text = normalizePlainText(message);
  if (hasImage) return localAction('Vi que adjuntaste una imagen, pero esta ruta trabaja mejor con texto. Escribeme el valor, la cuenta o el movimiento que aparece ahi y lo registro o lo analizo.', 'explicacion', ['Escribir el valor o movimiento de la imagen']);
  if (['hola', 'holaa', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hey', 'ola'].includes(text)) return localAction('Hola. Estoy listo: dime valor, cuenta y si fue ingreso o gasto. Ejemplo: ingresa 200 mil a Cuenta edison.');
  if (['gracias', 'muchas gracias', 'listo gracias', 'ok gracias', 'perfecto gracias'].includes(text)) return localAction('Con gusto. Cuando quieras registrar otro movimiento o revisar como vas, me escribes.');
  if (['ok', 'okay', 'dale', 'listo', 'perfecto', 'bueno'].includes(text)) return localAction('Listo. Quedo atento a lo que quieras registrar o revisar.');
  if (['que puedes hacer', 'que haces', 'ayuda', 'como funciona'].includes(text)) return localAction('Puedo registrar ingresos/gastos, analizar el mes, revisar deudas y detectar errores. Para registrar bien, dime siempre valor y cuenta: por ejemplo, "ingresa 10 mil a Nequi".', 'explicacion', ['Registrar ingreso', 'Registrar gasto', 'Analizar el mes']);
  return null;
}

function validateActionAccount(rawUserMessage: string, action: any, accounts: ParsedAccount[]): any {
  if (action?.intent !== 'create_transaction' || !action?.transaction) return action;
  const resolution = resolveAccountForTransaction(rawUserMessage, action.transaction.accountName, accounts);
  if (resolution.status !== 'matched') return accountClarificationAction(resolution);
  const previousName = String(action.transaction.accountName || '').trim();
  const corrected = {
    ...action,
    transaction: { ...action.transaction, accountName: resolution.accountName },
    confidence: Math.max(Number(action.confidence || 0.75), 0.95),
    insights: [
      ...(Array.isArray(action.insights) ? action.insights : []),
      { title: 'Cuenta validada', detail: `${resolution.accountName}. ${resolution.reason}`, severity: 'low' },
    ],
  };
  if (previousName && normalizePlainText(previousName) !== normalizePlainText(resolution.accountName)) {
    corrected.replyToUser = String(action.replyToUser || '').replace(new RegExp(escapeRegExp(previousName), 'gi'), resolution.accountName);
    if (!corrected.replyToUser.includes(resolution.accountName)) corrected.replyToUser = `Listo, lo registro en ${resolution.accountName}.`;
  }
  return corrected;
}

function safeActionFromContent(content: string, rawUserMessage: string, accounts: ParsedAccount[]) {
  try {
    const action = JSON.parse(extractJsonObject(content));
    return validateActionAccount(rawUserMessage, action, accounts);
  } catch (error) {
    console.error('DeepSeek returned non JSON content', error, String(content || '').slice(0, 1200));
    return {
      intent: 'conversation_only',
      replyToUser: String(content || 'Te escucho, pero la IA respondio en un formato que la app no pudo interpretar. Intenta escribir la solicitud de nuevo con una accion concreta.'),
      confidence: 0.35,
      assistantMode: 'conversacion',
      riskLevel: 'medium',
      emotionalTone: 'neutral',
      insights: [{ title: 'Respuesta recuperada', detail: 'DeepSeek respondio, pero no en el JSON exacto que necesita la app.', severity: 'medium' }],
      suggestedActions: ['Reformular la solicitud con una accion concreta'],
      suggestedNextQuestion: '',
      memoryPatch: {},
    };
  }
}

async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('FIREBASE_WEB_API_KEY no esta configurada en Vercel.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data?.users) || data.users.length === 0) throw new Error(data?.error?.message || 'Token de Firebase invalido.');
  return { uid: String(data.users[0].localId), email: data.users[0].email };
}

export default async function handler(req: any, res: any) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://ingresos-egresos-hogar.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sesion requerida para usar el asistente financiero.', source: 'auth' });

  let verifiedUser: { uid: string; email?: string };
  try {
    verifiedUser = await verifyFirebaseToken(token);
  } catch (error: any) {
    return res.status(401).json({ error: 'Sesion invalida o vencida.', details: String(error?.message || error), source: 'auth' });
  }

  const { message, imageBase64, imageMimeType, context, chatHistory, excelImportContext, aiMemory, diagnosticContext } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'El mensaje es obligatorio.' });
  if (message.length > 4000) return res.status(413).json({ error: 'El mensaje es demasiado largo.' });

  const hasImage = Boolean(imageBase64 && imageMimeType);
  const accounts = parseAccountsFromContext(context);
  const localConversationAction = buildCheapLocalConversation(message, hasImage);
  if (localConversationAction && !excelImportContext) return res.status(200).json({ action: localConversationAction, model: 'local-router-safe' });

  const fastAction = !hasImage && !excelImportContext ? buildFastTransactionAction(message, context) : null;
  if (fastAction) return res.status(200).json({ action: fastAction, model: 'local-fast-transaction-safe' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY no esta configurada en Vercel para este proyecto.', source: 'vercel-env' });

  const accountNames = accounts.map((account) => account.name).join(', ') || 'sin cuentas disponibles';
  const excelContextBlock = excelImportContext ? `\n\nEXCEL ADJUNTO POR EL USUARIO:\n${String(excelImportContext).slice(0, 12000)}\n\nAnaliza este Excel como migracion financiera. No digas que ya guardaste si aun no confirmo.` : '';
  const imageContextBlock = hasImage ? '\n\nNOTA TECNICA: El usuario adjunto una imagen, pero este endpoint solo acepta texto. Pidele que escriba valor, cuenta y movimiento.' : '';

  const systemPrompt = `
Eres el copiloto principal de "Ingresos y Egresos Hogar". Responde siempre SOLO JSON valido.

USUARIO AUTENTICADO
uid: ${verifiedUser.uid}
email: ${verifiedUser.email || 'sin email'}

CUENTAS REALES DISPONIBLES
${accountNames}

REGLA CONTABLE CRITICA DE CUENTAS
- Para crear movimientos, usa una accountName que exista exactamente en CUENTAS REALES DISPONIBLES.
- La app validara de nuevo la cuenta antes de guardar. Tu respuesta no es autoridad final contable.
- Las cuentas personalizadas tienen prioridad sobre genericos. Si existe "Cuenta edison" y el usuario dice "cuenta de banco edison", debes usar "Cuenta edison", no "Banco".
- Nunca elijas Nequi, Banco o Efectivo por saldo o por suposicion.
- Si el usuario menciona una cuenta que no existe o hay ambiguedad, usa intent "clarify" y pregunta una sola cosa.
- Si el usuario no menciona cuenta y hay varias cuentas, usa intent "clarify". No uses una cuenta por defecto.
- No prometas cambios masivos, limpiezas ni correcciones multiples. Pide confirmacion o explica el flujo.

ACCIONES SOPORTADAS
crear UN movimiento, crear UNA deuda, consultar, sugerir, pedir aclaracion, borrar/corregir UN movimiento claro con confirmacion, abonar/cerrar UNA deuda clara con confirmacion.

FORMATO OBLIGATORIO
{
  "intent": "create_transaction" | "query_summary" | "analyze_behavior" | "financial_advice" | "update_transaction" | "delete_transaction" | "create_debt" | "query_debts" | "register_debt_payment" | "close_debt" | "clarify" | "conversation_only" | "import_transactions",
  "replyToUser": "respuesta natural y concreta",
  "confidence": 0.0,
  "assistantMode": "registro" | "analisis" | "coach" | "emocional" | "estrategia" | "explicacion" | "tecnico" | "creativo" | "conversacion",
  "riskLevel": "low" | "medium" | "high",
  "emotionalTone": "calm" | "encouraging" | "alert" | "neutral",
  "insights": [],
  "suggestedActions": [],
  "suggestedNextQuestion": "",
  "memoryPatch": {}
}

Para crear movimiento incluye transaction con type, amount, currency COP, category, accountName, description, date.

MEMORIA ACTUAL
${String(aiMemory || 'Sin memoria guardada').slice(0, 3500)}

DIAGNOSTICO PRECALCULADO
${String(diagnosticContext || 'Sin diagnostico').slice(0, 4500)}

CONTEXTO FINANCIERO REAL
${String(context || 'Sin contexto disponible').slice(0, 9000)}
${excelContextBlock}
${imageContextBlock}
`;

  const payload = {
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      ...safeHistory(chatHistory),
      { role: 'user', content: hasImage ? `${message}\n\n[El usuario adjunto una imagen; pide los datos escritos si son necesarios.]` : message },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    temperature: 0.2,
    max_tokens: 4096,
  };

  try {
    const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await dsResponse.text();
    if (!dsResponse.ok) return res.status(502).json({ error: 'DeepSeek V4 Pro rechazo la solicitud.', status: dsResponse.status, details: raw.slice(0, 1500), source: 'deepseek-v4-pro' });
    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'DeepSeek V4 Pro respondio vacio.', source: 'deepseek-v4-pro' });
    return res.status(200).json({ action: safeActionFromContent(content, message, accounts), model: 'deepseek-v4-pro-safe' });
  } catch (error: any) {
    console.error('Vercel DeepSeek safe route failed', error?.message || error);
    return res.status(500).json({ error: 'Fallo la ruta Vercel segura de DeepSeek V4 Pro.', details: String(error?.message || error), source: 'vercel-route' });
  }
}
