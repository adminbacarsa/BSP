"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlatformAssistant = runPlatformAssistant;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
const cospKnowledge_1 = require("./cospKnowledge");
const assistantDataTools_1 = require("./assistantDataTools");
const assistantToolDeclarations_1 = require("./assistantToolDeclarations");
const resolveAssistantUser_1 = require("./resolveAssistantUser");
const ASSISTANT_RESPONSE_STYLE = `
Cómo responder (subir calidad sin inventar datos):

1) **No** abras diciendo en qué ruta o pantalla está el usuario (evitá "Estás en…" o URLs). El chat ya muestra el módulo arriba.

2) **No** incluyas rutas técnicas tipo \`/admin/…\`, \`/empleado/…\` ni \`/cliente/…\` en respuestas normales (incluido listados tipo "qué podés responder" o "qué módulos hay"). Referí al lugar por **nombre del ítem del menú lateral** (p. ej. "Servicios y SLA", "Planificación y Turnos", "Operaciones", "Clientes y Objetivos", "RRHH", "Reportes", "Configuración"). **Solo** si el usuario pregunta explícitamente por la **URL**, la **barra de direcciones** o "en qué link", podés mencionar una ruta concreta.

3) Si al inicio del mensaje de sistema aparece el bloque **MÉTRICAS YA CALCULADAS EN ESTE TURNO**, **usá esas cifras** para totales de nómina panel, SLA del mes u operaciones del día de referencia cuando la pregunta coincida; no inventes otros totales genéricos. Si preguntaron **cantidad exacta** (cuántos, cuántas, número de…): después de datos de herramientas o de ese bloque, **respondé ese número en la primera oración**. Para **servicios SLA / «cuántos servicios activos» como en el panel o KPI del mes** usá **contar_servicios_sla_vigentes_empresa** y el campo **cuenta_para_tarjeta_servicios_activos_del_mes** (y **cuenta_objetivos_distintos_con_sla_en_ese_mes** si hablan de objetivos). **Nunca inventes nombres de contratos o SLA**: si listás cuáles son, los textos salen **solo** del array muestra_contratos_en_mes (campos cliente y objetivo) devuelto por esa herramienta; si no alcanza la muestra, decí que hay más y que revisen el módulo Servicios y SLA. Para **empleados en nómina / vigiladores en plantilla** como la tarjeta del panel usá **contar_empleados_plantilla_empresa** y **cuenta_para_tarjeta_panel_empleados_nomina**. Para **quién está de franco o en RET** un día usá **listado_franco_ret_dia**; si necesitás **id_objetivo_cercania** y el usuario dio sólo el nombre del sitio, llamá antes **buscar_objetivos_por_nombre**. Para lista de guardias por día según Operaciones usá **listado_turnos_operativos_dia**; para totales de presencia **resumen_presencias_objetivos_dia**; empleados concretos: buscar + **consultar_turnos_empleado**. No te limites sólo al tutorial UI si existe herramienta numérica lista.

4) Para procedimientos ("cómo hago…"): **lista numerada** con **doble salto de línea entre pasos** (así queda punto y aparte al renderizar). Párrafos cortos. Resaltá controles con **negritas**: **Cliente**, **Objetivo**, **grilla**, **publicar cronograma**.

5) En resúmenes o varios temas seguidos: **un párrafo o un ítem por bloque**, separados con línea en blanco; no amontones todo en un solo párrafo.

6) Evitá títulos tipo #; sin rollos legales si no pidieron eso.
`.trim();
const MAX_MESSAGES = 24;
const MAX_CONTENT = 2600;
function clampMessages(raw) {
    const out = [];
    const slice = raw.slice(-MAX_MESSAGES);
    for (const m of slice) {
        if (m.role !== 'user' && m.role !== 'assistant')
            continue;
        const content = String(m.content ?? '')
            .trim()
            .slice(0, MAX_CONTENT);
        if (!content)
            continue;
        out.push({ role: m.role, content });
    }
    return out;
}
function fuseConsecutiveSameRole(ms) {
    const o = [];
    for (const m of ms) {
        if (o.length > 0 && o[o.length - 1].role === m.role) {
            const prev = o[o.length - 1];
            o[o.length - 1] = {
                role: prev.role,
                content: `${prev.content}\n\n${m.content}`.slice(0, MAX_CONTENT * 2),
            };
        }
        else {
            o.push({ ...m });
        }
    }
    return o;
}
function personaModuleBlurb(persona, readableKeys, moduleKey) {
    const parts = [];
    if (persona === 'SYSTEM') {
        parts.push(`Perfil BACKOFFICE/COSP. Tiene alcance declarado sólo sobre módulos con permiso READ: ${readableKeys.sort().join(', ') || '(ninguno listado)'}.`);
        parts.push('No describas flujos de módulos que no estén en esa lista. En mensajes al usuario no listes URLs /admin/…; usá nombres del menú.');
        parts.push(`Referencia interna de módulos (no volcar textual al usuario):`);
        readableKeys.slice(0, 12).forEach((k) => {
            const h = cospKnowledge_1.ADMIN_MODULE_ROUTE_HINTS[k];
            if (h)
                parts.push(`- ${k}: ${h}`);
        });
    }
    else if (persona === 'EMPLOYEE') {
        parts.push('Perfil PORTAL EMPLEADO: responder sobre turnos propios, presencia marcada desde portal/ausencias, avisos. No exponer otros empleados por nombre salvo ejemplo genérico. No menciones URLs administrativas salvo que el usuario pregunte explícitamente por el acceso web del personal de oficina.');
    }
    else {
        parts.push('Perfil PORTAL CLIENTE: vistas de cliente (accesos, personal autorizado, consultas típicas según desarrollo). Orientar sobre qué hacer si no encuentra función (contactar empresa de seguridad, etc.). Sin datos operativos de otros clientes.');
    }
    if (moduleKey) {
        parts.push(`Foco de pantalla declarado (moduleKey "${moduleKey}") — usar sólo como contexto orientativo si es coherente con el perfil.`);
    }
    return parts.join('\n');
}
function serverTodayCordobaYsMmDd() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return y && m && d ? `${y}-${m}-${d}` : new Date().toISOString().slice(0, 10);
}
function normalizeClientTodayYsMmDd(raw) {
    const s = String(raw ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled, metricsVerifiedBlock) {
    const guide = (0, cospKnowledge_1.operationalGuideForModuleKey)(moduleKey);
    return [
        `Sos la asistente virtual de COSP (Grupo Bacar). Español Argentina, tono claro y servicial.`,
        metricsVerifiedBlock ? `${metricsVerifiedBlock}\n` : '',
        ASSISTANT_RESPONSE_STYLE,
        '',
        cospKnowledge_1.COSP_PLATFORM_KNOWLEDGE,
        guide ? `\n${guide}` : '',
        '',
        `HERRAMIENTAS servidor (solo si el cliente mostró empresa válida + permiso):`,
        toolsEnabled
            ? `Activadas sólo lectura Firestore empresa actual. Interpretá «hoy» como fechaReferenciaCliente=${referenceYsMmDd} cuando el usuario no precise otra fecha.`
            : 'Desactivadas (portal cliente sin datos ajenos, o falta empresa en sesión para superusuarios sin contexto — orientá sólo UI).',
        '',
        `Contexto servidor (verificado por backend):`,
        `- Perfil efectivo: ${profile.summaryLabel} (${profile.persona})`,
        `- Ruta navegador (orientativa): "${pathname}"`,
        `- fechaReferenciaCliente (hoy): "${referenceYsMmDd}"`,
        ...(moduleKey ? [`- moduleKey cliente (orientativo): "${moduleKey}"`] : []),
        '',
        personaModuleBlurb(profile.persona, profile.readableModuleKeys, moduleKey || undefined),
        '',
        `Reglas: No inventés convocatorias APIs internas nuevas ni prometés ejecutar cambios sobre datos.`,
        `Si falta información o el usuario necesita soporte urgente ante fallo técnico, sugerís contactar a operaciones/IT.`,
    ].join('\n');
}
async function runPlatformAssistant(uid, payload) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey?.trim()) {
        const emu = process.env.FUNCTIONS_EMULATOR === 'true';
        throw new functions.https.HttpsError('failed-precondition', emu
            ? 'Emulador: falta GEMINI_API_KEY en apps/functions/.env (o .env.local). Secrets de producción no se montan aquí — reiniciá el emulador de Functions después de guardar.'
            : 'GEMINI_API_KEY no configurada en Firebase Functions. Ejecutá `firebase functions:secrets:set GEMINI_API_KEY` y `firebase deploy --only functions:chatPlatformAssistant`.');
    }
    const messages = fuseConsecutiveSameRole(clampMessages(payload.messages ?? []));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        throw new functions.https.HttpsError('invalid-argument', 'Enviá al menos un mensaje de usuario al final.');
    }
    const profile = await (0, resolveAssistantUser_1.resolveAssistantUser)(uid);
    if (!profile) {
        throw new functions.https.HttpsError('permission-denied', 'Tu cuenta no está asociada a usuarios COSP conocidos para el asistente.');
    }
    const claimedEmpresa = typeof payload.empresaId === 'string' ? payload.empresaId : '';
    if (!(0, resolveAssistantUser_1.empresaAllowed)(claimedEmpresa && claimedEmpresa.length > 0 ? claimedEmpresa : undefined, profile)) {
        throw new functions.https.HttpsError('permission-denied', 'Sesión empresa no coincide con el perfil de usuario.');
    }
    const pathname = String(payload.pathname ?? '/').slice(0, 400);
    const moduleKey = typeof payload.moduleKey === 'string' ? payload.moduleKey.trim().slice(0, 64) || null : null;
    const claimedTrim = claimedEmpresa.trim();
    let historyMsgs = [...messages];
    while (historyMsgs.length > 0 && historyMsgs[0].role === 'assistant') {
        historyMsgs = historyMsgs.slice(1);
    }
    const lastTurn = historyMsgs[historyMsgs.length - 1];
    const lastUser = lastTurn?.role === 'user' ? lastTurn.content : '';
    const priorRaw = historyMsgs.slice(0, -1);
    if (!lastUser.trim()) {
        throw new functions.https.HttpsError('invalid-argument', 'Mensaje vacío.');
    }
    const historyFiltered = [];
    for (let i = 0; i < priorRaw.length; i++) {
        const m = priorRaw[i];
        historyFiltered.push({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
        });
    }
    let selfEmployeeId = null;
    if (profile.persona === 'EMPLOYEE') {
        selfEmployeeId = await (0, assistantDataTools_1.resolveSelfEmployeeFirestoreId)(uid);
    }
    let empresaForTools = profile.empresaId.trim() || claimedTrim;
    if (profile.persona === 'EMPLOYEE' && selfEmployeeId) {
        const ed = await admin.firestore().collection('empleados').doc(selfEmployeeId).get();
        const row = ed.data();
        if (row?.empresaId)
            empresaForTools = String(row.empresaId).trim();
    }
    if (profile.persona === 'CLIENT') {
        empresaForTools = '';
    }
    const clientYmd = normalizeClientTodayYsMmDd(payload.clientToday);
    const referenceYsMmDd = clientYmd || serverTodayCordobaYsMmDd();
    const toolCtx = {
        persona: profile.persona,
        empresaId: empresaForTools,
        readableModuleKeys: profile.readableModuleKeys,
        selfEmployeeFirestoreId: selfEmployeeId,
        referenceDateYsMmDd: referenceYsMmDd,
    };
    const toolsEnabled = (0, assistantDataTools_1.assistantToolsEnabledForContext)(toolCtx);
    let metricsVerifiedBlock = '';
    if (toolsEnabled && profile.persona === 'SYSTEM' && empresaForTools.trim()) {
        try {
            metricsVerifiedBlock = await (0, assistantDataTools_1.buildEmpresaMetricsSnapshotForPrompt)(toolCtx);
        }
        catch (e) {
            console.warn('[assistant] buildEmpresaMetricsSnapshotForPrompt', e);
        }
    }
    const systemInstruction = buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled, metricsVerifiedBlock || undefined);
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    return runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx);
}
function extractAssistantTextSafe(response) {
    try {
        const t = response.text?.();
        if (typeof t === 'string' && t.trim())
            return t.trim();
    }
    catch (e) {
        console.warn('[assistant] response.text()', e?.message);
    }
    const cand = response.candidates?.[0];
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts))
        return '';
    const chunks = [];
    for (const p of parts) {
        const tx = typeof p === 'object' && p && 'text' in p ? String(p.text ?? '') : '';
        if (tx.trim())
            chunks.push(tx);
    }
    return chunks.join('\n').trim();
}
function mapGeminiErrorToHint(e) {
    if (e instanceof generative_ai_1.GoogleGenerativeAIResponseError || e instanceof generative_ai_1.GoogleGenerativeAIFetchError) {
        return e.message.slice(0, 420);
    }
    if (e instanceof Error)
        return e.message.slice(0, 420);
    return String(e).slice(0, 420);
}
async function runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx) {
    const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: { maxOutputTokens: 8192, temperature: 0.35 },
        ...(toolsEnabled
            ? {
                tools: [{ functionDeclarations: assistantToolDeclarations_1.ASSISTANT_FUNCTION_DECLARATIONS }],
                toolConfig: { functionCallingConfig: { mode: generative_ai_1.FunctionCallingMode.AUTO } },
            }
            : {}),
    });
    const chat = model.startChat({ history: historyFiltered });
    let result;
    try {
        result = await chat.sendMessage(lastUser);
    }
    catch (e) {
        console.error('[assistant] sendMessage(inicial)', mapGeminiErrorToHint(e));
        throw new functions.https.HttpsError('failed-precondition', mapGeminiErrorToHint(e));
    }
    let rounds = 0;
    while (toolsEnabled && rounds < assistantToolDeclarations_1.ASSISTANT_TOOL_ROUNDS_MAX) {
        rounds++;
        let calls = [];
        try {
            calls = result.response.functionCalls?.() ?? [];
        }
        catch {
            calls = [];
        }
        if (!calls.length)
            break;
        const responseParts = await Promise.all(calls.map(async (fc) => {
            const args = (fc.args ?? {});
            const out = await (0, assistantDataTools_1.dispatchAssistantToolCall)(toolCtx, fc.name, args);
            return {
                functionResponse: {
                    name: fc.name,
                    response: out,
                },
            };
        }));
        try {
            result = await chat.sendMessage(responseParts);
        }
        catch (e) {
            console.error('[assistant] sendMessage(herramienta)', mapGeminiErrorToHint(e));
            throw new functions.https.HttpsError('failed-precondition', mapGeminiErrorToHint(e));
        }
    }
    let reply = extractAssistantTextSafe(result.response);
    if (!reply && toolsEnabled) {
        try {
            result = await chat.sendMessage('Contestá sólo texto al usuario en español, sin invocar herramientas, en unas pocas oraciones.');
            reply = extractAssistantTextSafe(result.response);
        }
        catch (e) {
            console.warn('[assistant] recuperación texto', mapGeminiErrorToHint(e));
        }
    }
    if (!reply) {
        throw new functions.https.HttpsError('failed-precondition', 'El modelo no devolvió texto. Probá de nuevo en un momento o formulá más corto.');
    }
    return { reply: reply.slice(0, 8000) };
}
//# sourceMappingURL=runPlatformAssistant.js.map