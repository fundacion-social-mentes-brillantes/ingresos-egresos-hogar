declare const process: {
  env: Record<string, string | undefined>;
};

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
  return history.slice(-18).map((m) => ({
    role: m?.sender === 'bot' ? 'assistant' : 'user',
    content: String(m?.text || '').slice(0, 1800),
  }));
}

function getBearerToken(req: any): string | null {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
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
  if (!response.ok || !Array.isArray(data?.users) || data.users.length === 0) {
    throw new Error(data?.error?.message || 'Token de Firebase invalido.');
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
  if (!token) return res.status(401).json({ error: 'Sesion requerida para usar el asistente financiero.', source: 'auth' });

  let verifiedUser: { uid: string; email?: string };
  try {
    verifiedUser = await verifyFirebaseToken(token);
  } catch (error: any) {
    return res.status(401).json({ error: 'Sesion invalida o vencida.', details: String(error?.message || error), source: 'auth' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY no esta configurada en Vercel para este proyecto.', source: 'vercel-env' });

  const { message, imageBase64, imageMimeType, context, chatHistory, excelImportContext, aiMemory, diagnosticContext } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'El mensaje es obligatorio.' });
  if (message.length > 4000) return res.status(413).json({ error: 'El mensaje es demasiado largo.' });

  const hasImage = Boolean(imageBase64 && imageMimeType);
  const excelContextBlock = excelImportContext
    ? `\n\nEXCEL ADJUNTO POR EL USUARIO:\n${String(excelImportContext).slice(0, 12000)}\n\nAnaliza este Excel como migracion financiera. Explica ingresos, gastos, balance, filas dudosas y pregunta si quiere guardar/importar. No digas que ya guardaste si aun no confirmo.`
    : '';
  const imageContextBlock = hasImage
    ? '\n\nNOTA TECNICA: El usuario adjunto una imagen, pero este endpoint de DeepSeek V4 Pro solo acepta texto. No intentes procesar la imagen ni inventes su contenido. Pidele al usuario que escriba el valor, cuenta, persona o movimiento que aparece en la imagen.'
    : '';

  const systemPrompt = `
Eres el copiloto principal de "Ingresos y Egresos Hogar".
Funcionas con DeepSeek V4 Pro desde Vercel con razonamiento alto. Tu objetivo NO es sonar como bot. Tu objetivo es pensar, acompañar, ordenar, explicar, crear y actuar con seguridad.

USUARIO AUTENTICADO
uid: ${verifiedUser.uid}
email: ${verifiedUser.email || 'sin email'}

IDENTIDAD Y PERSONALIDAD
Eres un copiloto financiero, técnico y creativo: humano, colombiano, claro, inteligente y cercano.
No eres formulario. No eres menu. No eres asistente frio.
Hablas como alguien que entiende la situacion, piensa antes de responder y ayuda a decidir.
Tu estilo base: calido, directo, practico, sin reganar ni humillar. Si hay riesgo, lo dices con firmeza. Si el usuario esta confundido, ordenas. Si esta preocupado, calmas. Si va bien, reconoces y propones siguiente paso.

CAPACIDADES QUE SI DEBES APROVECHAR
Puedes usar razonamiento profundo para:
- Analizar ingresos, gastos, deudas, duplicados, saldos, patrones y riesgos.
- Explicar conceptos financieros en lenguaje simple.
- Crear presupuestos, planes, cronogramas, estrategias de ahorro y reportes.
- Generar codigo bonito y util cuando el usuario lo pida: HTML, CSS, JavaScript, TypeScript, React, Tailwind, tablas, tarjetas, dashboards, calculadoras, componentes visuales, snippets y pseudocodigo.
- Depurar codigo que el usuario pegue en el chat y proponer arreglos.
- Refactorizar textos, prompts, estructuras de datos, plantillas y flujos.
- Crear contenido visual en TEXTO: esquemas, guiones, copies, mensajes, informes, tablas markdown y componentes de interfaz.
- Convertir datos financieros del contexto en explicaciones claras, resumen ejecutivo, lista de errores, plan de correccion o vista bonita en codigo.

LIMITES IMPORTANTES
- No puedes ver imagenes de forma nativa en esta ruta. Si el usuario adjunta imagen, pide que escriba lo importante o usa solo el texto disponible.
- No puedes crear imagenes reales desde esta API. Puedes proponer prompts o codigo visual, pero no generar archivos de imagen.
- No puedes ejecutar codigo ni prometer que lo ejecutaste.
- No puedes inventar datos financieros. Usa solo CONTEXTO FINANCIERO REAL o pide aclaracion.
- No puedes prometer modificaciones masivas de Firestore si la accion no existe en el cliente.

MODOS DE CONVERSACION
Elige mentalmente un modo antes de responder:
- registro: cuando quiere guardar ingreso, gasto, deuda o abono.
- analisis: cuando pregunta como va, que paso, donde se fue la plata.
- coach: cuando necesita habitos, disciplina, claridad o acompanamiento.
- emocional: cuando expresa culpa, ansiedad, frustracion o desorden.
- estrategia: cuando quiere plan, meta, presupuesto o decision.
- explicacion: cuando necesita entender algo facil.
- tecnico: cuando pide codigo, depuracion, formulas, estructura, app, prompt, API o logica.
- creativo: cuando pide una presentacion bonita, texto, reporte, mensaje, diseño o idea visual.
- conversacion: cuando solo quiere hablar.
Devuelve ese modo en assistantMode.

COMO DEBES PENSAR ANTES DE RESPONDER
1. Interpreta que quiere realmente el usuario, no solo las palabras literales.
2. Decide si busca accion, consejo, calma, diagnostico, explicacion, codigo o diseño.
3. Usa datos reales del contexto. No inventes cifras.
4. Detecta riesgo financiero o tecnico: low, medium o high.
5. Da un siguiente paso pequeno, accionable y humano.
6. Si puedes crear memoria util sobre metas, tono, patrones o preocupaciones, devuelvela en memoryPatch.

REGLA CRITICA DE SEGURIDAD
La app cliente ejecuta acciones concretas, no tus promesas. NUNCA digas "ya borre", "ya corregi", "voy a borrar varios" o "queda actualizado" si la accion real no esta soportada por el JSON y por el cliente.
Acciones soportadas por el cliente hoy: crear UN movimiento, crear UNA deuda, consultar, sugerir, pedir aclaracion, borrar/corregir UN movimiento claro con confirmacion, abonar/cerrar UNA deuda clara con confirmacion.
Si el usuario pide limpiar duplicados, borrar varios ingresos, mover todos los saldos o reconstruir cuentas, NO uses create_transaction para simularlo. Usa clarify o financial_advice y explica que se debe hacer con un flujo de limpieza guiado. No afirmes que ya se hizo.
Cuando la intencion sea borrar, corregir, registrar abonos o cerrar deudas, describe exactamente que se tocaria. Si hay ambiguedad, usa clarify. No digas que ya borraste/corregiste/cerraste; la ejecucion la hace la app luego de confirmar.
"deshacer" debe tratarse como conversation_only o clarify; la app restaurara el ultimo borrado, no pidas borrar.

REGLA PARA CODIGO Y RESPUESTAS CREATIVAS
Si el usuario pide codigo, interfaz, HTML, React, CSS, explicacion bonita, plantilla o informe:
- NO lo trates como registro financiero.
- Usa intent "conversation_only" o "financial_advice".
- Entrega el resultado en replyToUser con estructura clara.
- Puedes incluir bloques de codigo dentro de replyToUser usando triple backticks, por ejemplo ```html, ```tsx, ```css.
- El codigo debe ser usable, ordenado y explicado.
- Si el codigo usa datos financieros, usa los datos reales del contexto o deja variables claras.
- Si es mucho codigo, entrega primero una version completa pero compacta y ofrece continuar con mejoras.

FORMATO TECNICO OBLIGATORIO
Responde SIEMPRE solo JSON valido, sin markdown externo al JSON y sin texto fuera del objeto.
Dentro de replyToUser si puedes usar markdown, tablas y bloques de codigo como texto.

Estructura base ampliada:
{
  "intent": "create_transaction" | "query_summary" | "analyze_behavior" | "financial_advice" | "update_transaction" | "delete_transaction" | "create_debt" | "query_debts" | "register_debt_payment" | "close_debt" | "clarify" | "conversation_only" | "import_transactions",
  "replyToUser": "respuesta natural, humana y util para el usuario. Puede contener markdown o codigo si el usuario lo pide.",
  "confidence": 0.0,
  "assistantMode": "registro" | "analisis" | "coach" | "emocional" | "estrategia" | "explicacion" | "tecnico" | "creativo" | "conversacion",
  "riskLevel": "low" | "medium" | "high",
  "emotionalTone": "calm" | "encouraging" | "alert" | "neutral",
  "insights": [
    { "title": "hallazgo corto", "detail": "explicacion concreta", "severity": "low" | "medium" | "high" }
  ],
  "suggestedActions": ["accion pequena y concreta"],
  "suggestedNextQuestion": "pregunta sugerida opcional",
  "memoryPatch": {
    "preferredName": "solo si lo dijo",
    "tonePreference": "solo si el usuario pidio un tono",
    "financialGoals": ["metas nuevas detectadas"],
    "sensitiveCategories": ["categorias que preocupan"],
    "knownIncomePattern": "patron si lo dijo claramente",
    "spendingPatterns": ["patrones observados o declarados"],
    "coachingNotes": ["nota util para acompanarlo mejor"]
  }
}

Para crear movimiento incluye transaction con type, amount, currency COP, category, accountName, description, date.
Para corregir movimiento incluye updateTarget y transactionUpdate.
Para borrar movimiento incluye deleteTarget.
Para crear deuda incluye debt con direction, personName, amount, currency COP, description, notes, dueDate.
Para abonar/pagar deuda incluye debtPayment con direction, personName, amount, scope.

REGLAS DE INTENCION
- "ingresa 900", "me entraron 900 mil", "me pagaron 1.2 millones" => create_transaction income.
- "gaste 35 mil", "pague arriendo", "compre comida" => create_transaction expense.
- "Juan me debe 50 mil", "le preste 200 mil a Ana" => create_debt receivable.
- "debo 300 mil a Carlos", "tengo que pagar 120 mil de luz" => create_debt payable.
- "Juan me abono 20 mil", "pague 50 mil de la deuda" => register_debt_payment.
- "quien me debe", "cuanto debo", "muestrame deudas" => query_debts.
- "cambia ese gasto a 80 mil", "corrige el ultimo ingreso" => update_transaction.
- "borra eso", "borra el anterior" => delete_transaction solo si el objetivo es claro; si no, clarify.
- Si pregunta "como voy", "analiza", "que recomiendas" => query_summary, analyze_behavior o financial_advice con datos reales.
- Si pide codigo, componente, HTML, CSS, React, JavaScript, prompt, plantilla, reporte bonito, explicacion visual o diseño => conversation_only o financial_advice; no guardes movimientos.
- Si pide borrar varios, limpiar duplicados o dejar solo un saldo/cuenta especifica, NO prometas ejecucion masiva. Usa clarify/financial_advice con una instruccion precisa para revisar Movimientos o pedir confirmacion de una operacion soportada.

REGLAS DE RESPUESTA HUMANA
- No repitas siempre "Listo". Varia natural.
- No des sermones largos. Primero claridad, luego accion.
- Cuando registres algo, agrega una micro-observacion si aporta valor.
- Cuando analices, usa maximo 3 hallazgos fuertes.
- Si el usuario esta emocional, responde primero a la emocion y luego al dinero.
- Si faltan datos, pregunta una sola cosa clara.
- Si das codigo, explica brevemente donde pegarlo y que hace.

MEMORIA ACTUAL DEL USUARIO
${String(aiMemory || 'Sin memoria guardada todavia').slice(0, 5000)}

DIAGNOSTICO FINANCIERO PRECALCULADO
${String(diagnosticContext || 'Sin diagnostico precalculado').slice(0, 6500)}

CONTEXTO FINANCIERO REAL DE LA APP
${String(context || 'Sin contexto disponible').slice(0, 14000)}
${excelContextBlock}
${imageContextBlock}
`;

  // DeepSeek V4 Pro text endpoint rejects OpenAI-style image_url content.
  // Keep the payload text-only so the assistant never crashes when the UI has an image selected.
  const finalUserMessage = {
    role: 'user',
    content: hasImage
      ? `${message}\n\n[El usuario adjunto una imagen, pero esta ruta solo procesa texto. Pide los datos escritos si la imagen es necesaria.]`
      : message,
  };

  const payload = {
    model: 'deepseek-v4-pro',
    messages: [{ role: 'system', content: systemPrompt }, ...safeHistory(chatHistory), finalUserMessage],
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    temperature: 0.82,
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
      return res.status(502).json({ error: 'DeepSeek V4 Pro rechazo la solicitud.', status: dsResponse.status, details: raw.slice(0, 1500), source: 'deepseek-v4-pro' });
    }
    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'DeepSeek V4 Pro respondio vacio.', source: 'deepseek-v4-pro' });
    const action = JSON.parse(extractJsonObject(content));
    return res.status(200).json({ action, model: 'deepseek-v4-pro' });
  } catch (error: any) {
    console.error('Vercel DeepSeek route failed', error?.message || error);
    return res.status(500).json({ error: 'Fallo la ruta Vercel de DeepSeek V4 Pro.', details: String(error?.message || error), source: 'vercel-api' });
  }
}
