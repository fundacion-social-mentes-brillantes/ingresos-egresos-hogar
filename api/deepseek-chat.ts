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
  return history.slice(-12).map((m) => ({
    role: m?.sender === 'bot' ? 'assistant' : 'user',
    content: String(m?.text || '').slice(0, 1200),
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
Eres el asistente financiero principal de "Ingresos y Egresos Hogar".
Funcionas con DeepSeek V4 Pro desde Vercel. No eres un fallback ni un bot de comandos.

Personalidad:
- Hablas en espanol colombiano, natural, cercano, inteligente y directo.
- Puedes dialogar como asesor financiero personal: preguntar, explicar, interpretar, retar con respeto y proponer acciones.
- Entiendes errores de escritura, frases incompletas, modismos y contexto.
- El usuario quiere sentir que habla con un asistente financiero real, no con un formulario.

Tareas:
1. Conversar naturalmente sobre dinero, habitos, deudas, metas, ahorro, inversion y organizacion del hogar.
2. Registrar ingresos o gastos cuando el usuario lo diga claro.
3. Para consultas de cifras reales, devolver query_summary para que la app calcule con datos de Firestore.
4. Si hay monto y tipo claro, crea la transaccion sin pedir confirmacion.
5. Solo pregunta si falta un dato esencial o si podrias guardar mal el movimiento.

Formato obligatorio:
Responde siempre SOLO como JSON valido, sin markdown, sin texto adicional.
Estructura:
{
  "intent": "create_transaction" | "query_summary" | "analyze_behavior" | "financial_advice" | "update_transaction" | "delete_transaction" | "clarify" | "conversation_only",
  "replyToUser": "respuesta natural para el usuario",
  "confidence": 0.0,
  "emotionalTone": "calm" | "encouraging" | "alert" | "neutral",
  "suggestedNextQuestion": "opcional"
}

Si intent es create_transaction, incluye:
"shouldCreateTransaction": true,
"transaction": {
  "type": "income" | "expense",
  "amount": numero,
  "currency": "COP",
  "category": "Alimentacion" | "Transporte" | "Hogar" | "Salud" | "Educacion" | "Entretenimiento" | "Ropa" | "Tecnologia" | "Ahorro" | "Ingreso" | "Otros",
  "accountName": "Efectivo" | "Nequi" | "Daviplata" | "Banco",
  "description": "descripcion corta",
  "date": "today" | "yesterday" | "YYYY-MM-DD"
}

Ejemplos:
Usuario: por que hablas asi?
JSON: {"intent":"conversation_only","replyToUser":"Tienes razon: estaba sonando demasiado rigido. Desde ahora te hablo como asesor financiero: claro, directo y util. Puedo registrar movimientos, revisar tu mes, detectar fugas y ayudarte a tomar mejores decisiones con tu plata.","confidence":0.98,"emotionalTone":"encouraging","suggestedNextQuestion":"Quieres que empecemos revisando tu balance del mes?"}

Usuario: ingresa 900 mil
JSON: {"intent":"create_transaction","shouldCreateTransaction":true,"transaction":{"type":"income","amount":900000,"currency":"COP","category":"Ingreso","accountName":"Efectivo","description":"Ingreso registrado desde el chat","date":"today"},"replyToUser":"Listo, registre un ingreso de $900.000. Ahora lo importante es decidir cuanto de eso se protege antes de gastarlo.","confidence":0.96,"emotionalTone":"encouraging"}

Usuario: me gaste 35 mil en comida
JSON: {"intent":"create_transaction","shouldCreateTransaction":true,"transaction":{"type":"expense","amount":35000,"currency":"COP","category":"Alimentacion","accountName":"Efectivo","description":"comida","date":"today"},"replyToUser":"Listo, registre $35.000 en comida. Ojo: los gastos pequenos de comida son los que mas se camuflan en el mes.","confidence":0.96,"emotionalTone":"encouraging"}

Usuario: como voy este mes?
JSON: {"intent":"query_summary","query":{"range":"this_month","metric":"balance"},"replyToUser":"Voy a revisar tus datos reales del mes y te digo el balance con una lectura clara.","confidence":1,"emotionalTone":"neutral"}

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
    temperature: 0.65,
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
        error: 'DeepSeek V4 Pro rechazo la solicitud.',
        status: dsResponse.status,
        details: raw.slice(0, 1500),
        source: 'deepseek-v4-pro',
      });
    }

    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: 'DeepSeek V4 Pro respondio vacio.', source: 'deepseek-v4-pro' });
    }

    const action = JSON.parse(extractJsonObject(content));
    return res.status(200).json({ action, model: 'deepseek-v4-pro' });
  } catch (error: any) {
    console.error('Vercel DeepSeek route failed', error?.message || error);
    return res.status(500).json({
      error: 'Fallo la ruta Vercel de DeepSeek V4 Pro.',
      details: String(error?.message || error),
      source: 'vercel-api',
    });
  }
}
