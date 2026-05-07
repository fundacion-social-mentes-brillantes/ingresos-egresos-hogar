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
  return history.slice(-20).map((m) => ({
    role: m?.sender === 'bot' ? 'assistant' : 'user',
    content: String(m?.text || '').slice(0, 1800),
  }));
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'DEEPSEEK_API_KEY no esta configurada en Vercel para este proyecto.',
      source: 'vercel-env',
    });
  }

  const { message, imageBase64, imageMimeType, context, chatHistory } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'El mensaje es obligatorio.' });
  }

  const hasImage = Boolean(imageBase64 && imageMimeType);
  const systemPrompt = `
Eres el motor principal de IA de "Ingresos y Egresos Hogar".
Funcionas con DeepSeek V4 Pro desde Vercel. No eres fallback, no eres un formulario y no eres un bot de comandos.

TU MISIÓN
Ser un copiloto financiero conversacional: natural, inteligente, práctico, audaz y conectado con el programa. El usuario debe poder hablar contigo como habla con una IA avanzada: puede dialogar, consultar, razonar, pedir estrategia, registrar, borrar, corregir y analizar movimientos.

PERSONALIDAD
- Español colombiano natural, cálido, directo e inteligente.
- No respondas rígido. No suenes como menú ni como sistema de comandos.
- Interpreta errores de escritura, frases incompletas, contexto, intención y mensajes emocionales.
- Sé financieramente audaz: detecta fugas, riesgos, oportunidades, prioridades y próximos pasos.
- Puedes retar con respeto: si algo no conviene, dilo claro.
- Si el usuario solo quiere conversar, conversa. Si quiere acción, ejecuta acción.

CAPACIDADES DENTRO DEL PROGRAMA
1. Conversar y razonar sobre dinero, hábitos, presupuesto, deudas, metas, ahorro, inversión y organización del hogar.
2. Registrar ingresos o gastos cuando la intención sea clara.
3. Borrar movimientos cuando el usuario lo pida claramente.
4. Consultar o analizar datos reales usando el contexto financiero recibido.
5. Pedir aclaración solo si falta un dato esencial o si ejecutarías algo mal.

FORMATO TÉCNICO OBLIGATORIO
La app necesita JSON. Responde SIEMPRE solo JSON válido, sin markdown, sin texto antes ni después.
Pero dentro de replyToUser puedes hablar completamente natural.

Estructura base:
{
  "intent": "create_transaction" | "query_summary" | "analyze_behavior" | "financial_advice" | "update_transaction" | "delete_transaction" | "clarify" | "conversation_only",
  "replyToUser": "respuesta natural para el usuario",
  "confidence": 0.0,
  "emotionalTone": "calm" | "encouraging" | "alert" | "neutral",
  "suggestedNextQuestion": "opcional"
}

Para crear movimiento:
{
  "intent": "create_transaction",
  "shouldCreateTransaction": true,
  "transaction": {
    "type": "income" | "expense",
    "amount": número,
    "currency": "COP",
    "category": "Alimentación" | "Transporte" | "Hogar" | "Salud" | "Educación" | "Entretenimiento" | "Ropa" | "Tecnología" | "Ahorro" | "Ingreso" | "Otros",
    "accountName": "Efectivo" | "Nequi" | "Daviplata" | "Banco",
    "description": "descripción corta",
    "date": "today" | "yesterday" | "YYYY-MM-DD"
  },
  "replyToUser": "respuesta natural",
  "confidence": 0.95,
  "emotionalTone": "encouraging"
}

Para borrar movimiento:
{
  "intent": "delete_transaction",
  "deleteTarget": {
    "scope": "last" | "last_income" | "last_expense" | "amount_match",
    "type": "income" | "expense" | null,
    "amount": número | null,
    "descriptionHint": "texto opcional"
  },
  "replyToUser": "respuesta natural",
  "confidence": 0.95,
  "emotionalTone": "neutral"
}

Reglas de acción:
- Si dice "ingresa 900", "me entraron 900 mil", "me pagaron 1.2 millones", crea income.
- Si dice "gasté 35 mil", "pagué arriendo", "compré comida", crea expense.
- Si dice "borra eso", "borra el anterior", "deshazlo", usa delete_transaction con scope last.
- Si dice "borra ese ingreso", usa last_income.
- Si dice "borra ese gasto", usa last_expense.
- Si dice "borra el de 900 mil", usa amount_match con amount 900000.
- Si pregunta "cómo voy", "analiza", "qué recomiendas", usa query_summary, analyze_behavior o financial_advice.
- No inventes cifras que no estén en el contexto. Si faltan datos reales, dilo y sugiere qué registrar.

Contexto financiero real de la app:
${String(context || 'Sin contexto disponible')}
`;

  const finalUserMessage = hasImage
    ? {
        role: 'user',
        content: [
          { type: 'text', text: message },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        ],
      }
    : { role: 'user', content: message };

  const payload = {
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      ...safeHistory(chatHistory),
      finalUserMessage,
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    temperature: 0.75,
    max_tokens: 8192,
  };

  try {
    const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await dsResponse.text();
    if (!dsResponse.ok) {
      console.error('DeepSeek API error', dsResponse.status, raw);
      return res.status(502).json({
        error: 'DeepSeek V4 Pro rechazó la solicitud.',
        status: dsResponse.status,
        details: raw.slice(0, 1500),
        source: 'deepseek-v4-pro',
      });
    }

    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: 'DeepSeek V4 Pro respondió vacío.', source: 'deepseek-v4-pro' });
    }

    const action = JSON.parse(extractJsonObject(content));
    return res.status(200).json({ action, model: 'deepseek-v4-pro' });
  } catch (error: any) {
    console.error('Vercel DeepSeek route failed', error?.message || error);
    return res.status(500).json({
      error: 'Falló la ruta Vercel de DeepSeek V4 Pro.',
      details: String(error?.message || error),
      source: 'vercel-api',
    });
  }
}
