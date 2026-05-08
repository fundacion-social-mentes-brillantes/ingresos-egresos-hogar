function extractJsonObject(content: string): string {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function safeHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-30).map((m) => ({
    role: m?.sender === 'bot' ? 'assistant' : 'user',
    content: String(m?.text || '').slice(0, 2500),
  }));
}

function getBearerToken(req: any): string | null {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) {
    throw new Error('FIREBASE_WEB_API_KEY no esta configurada en Vercel.');
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data?.users) || data.users.length === 0) {
    const detail = data?.error?.message || 'Token de Firebase invalido.';
    throw new Error(detail);
  }

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
  if (!token) {
    return res.status(401).json({ error: 'Sesion requerida para usar el asistente financiero.', source: 'auth' });
  }

  let verifiedUser: { uid: string; email?: string };
  try {
    verifiedUser = await verifyFirebaseToken(token);
  } catch (error: any) {
    return res.status(401).json({ error: 'Sesion invalida o vencida.', details: String(error?.message || error), source: 'auth' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'DEEPSEEK_API_KEY no esta configurada en Vercel para este proyecto.',
      source: 'vercel-env',
    });
  }

  const { message, imageBase64, imageMimeType, context, chatHistory, excelImportContext } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'El mensaje es obligatorio.' });
  if (message.length > 4000) return res.status(413).json({ error: 'El mensaje es demasiado largo.' });

  const hasImage = Boolean(imageBase64 && imageMimeType);
  const excelContextBlock = excelImportContext
    ? `\n\nEXCEL ADJUNTO POR EL USUARIO:\n${String(excelImportContext).slice(0, 12000)}\n\nAnaliza este Excel como migración financiera. Explica ingresos, gastos, balance, filas dudosas y pregunta si quiere guardar/importar. No digas que ya guardaste si aún no confirmó.`
    : '';

  const systemPrompt = `
Eres el motor principal de IA de "Ingresos y Egresos Hogar".
Funcionas con DeepSeek V4 Pro desde Vercel. No eres fallback, no eres un formulario y no eres un bot de comandos.

USUARIO AUTENTICADO
uid: ${verifiedUser.uid}
email: ${verifiedUser.email || 'sin email'}

TU MISIÓN
Ser un copiloto financiero conversacional: natural, inteligente, práctico, audaz y conectado con el programa.

REGLA CRÍTICA DE SEGURIDAD
La app cliente exige confirmación visual antes de ejecutar acciones peligrosas. Aun así, cuando la intención sea borrar, corregir, registrar abonos o cerrar deudas, describe exactamente qué se tocaría. Si hay ambigüedad, usa clarify. No inventes IDs ni confirmes que ya borraste/corregiste; la ejecución la hace la app luego de confirmar.

PERSONALIDAD
- Español colombiano natural, cálido, directo e inteligente.
- No respondas rígido. No suenes como menú ni como sistema de comandos.
- Interpreta errores de escritura, frases incompletas, contexto, intención y mensajes emocionales.
- Sé financieramente audaz: detecta fugas, riesgos, oportunidades, prioridades y próximos pasos.

FORMATO TÉCNICO OBLIGATORIO
Responde SIEMPRE solo JSON válido, sin markdown, sin texto antes ni después.

Estructura base:
{
  "intent": "create_transaction" | "query_summary" | "analyze_behavior" | "financial_advice" | "update_transaction" | "delete_transaction" | "create_debt" | "query_debts" | "register_debt_payment" | "close_debt" | "clarify" | "conversation_only" | "import_transactions",
  "replyToUser": "respuesta natural para el usuario",
  "confidence": 0.0,
  "emotionalTone": "calm" | "encouraging" | "alert" | "neutral",
  "suggestedNextQuestion": "opcional"
}

Para crear movimiento incluye transaction con: type, amount, currency COP, category, accountName, description, date.
Para corregir movimiento incluye updateTarget y transactionUpdate.
Para borrar movimiento incluye deleteTarget.
Para crear deuda incluye debt con direction, personName, amount, currency COP, description, notes, dueDate.
Para abonar/pagar deuda incluye debtPayment con direction, personName, amount, scope.

Reglas de intención:
- "ingresa 900", "me entraron 900 mil", "me pagaron 1.2 millones" => create_transaction income.
- "gasté 35 mil", "pagué arriendo", "compré comida" => create_transaction expense.
- "Juan me debe 50 mil", "le presté 200 mil a Ana" => create_debt receivable.
- "debo 300 mil a Carlos", "tengo que pagar 120 mil de luz" => create_debt payable.
- "Juan me abonó 20 mil", "pagué 50 mil de la deuda" => register_debt_payment.
- "quién me debe", "cuánto debo", "muéstrame deudas" => query_debts.
- "cambia ese gasto a 80 mil", "corrige el último ingreso" => update_transaction.
- "borra eso", "borra el anterior" => delete_transaction solo si el objetivo es claro; si no, clarify.
- "deshacer" debe tratarse como conversation_only o clarify; la app restaurará el último borrado, no debes pedir borrar.
- Si pregunta "cómo voy", "analiza", "qué recomiendas" => query_summary, analyze_behavior o financial_advice con datos reales.
- No inventes cifras que no estén en el contexto. Si faltan datos reales, dilo.

Contexto financiero real de la app:
${String(context || 'Sin contexto disponible').slice(0, 18000)}
${excelContextBlock}
`;

  const finalUserMessage = hasImage
    ? { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }] }
    : { role: 'user', content: message };

  const payload = {
    model: 'deepseek-v4-pro',
    messages: [{ role: 'system', content: systemPrompt }, ...safeHistory(chatHistory), finalUserMessage],
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    temperature: 0.75,
    max_tokens: 8192,
  };

  try {
    const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const raw = await dsResponse.text();
    if (!dsResponse.ok) {
      console.error('DeepSeek API error', dsResponse.status, raw);
      return res.status(502).json({ error: 'DeepSeek V4 Pro rechazó la solicitud.', status: dsResponse.status, details: raw.slice(0, 1500), source: 'deepseek-v4-pro' });
    }

    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'DeepSeek V4 Pro respondió vacío.', source: 'deepseek-v4-pro' });

    const action = JSON.parse(extractJsonObject(content));
    return res.status(200).json({ action, model: 'deepseek-v4-pro' });
  } catch (error: any) {
    console.error('Vercel DeepSeek route failed', error?.message || error);
    return res.status(500).json({ error: 'Falló la ruta Vercel de DeepSeek V4 Pro.', details: String(error?.message || error), source: 'vercel-api' });
  }
}
