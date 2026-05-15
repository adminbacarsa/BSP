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

1) Cuando el usuario pregunte "cómo hago…", "¿dónde veo…?" o pida nombres/turnos del día: abrí con una frase que **reconozca el lugar** (pathname y moduleKey declarados en contexto; ej. Estás en Planificación en /admin/planificacion).

2) Si tenés **herramientas de consulta** habilitadas en el contexto: usalas para turnos/presencia/planificación real **antes** de inventar. Si la herramienta devuelve varias personas con nombre parecido, pedí aclaración al usuario y no afirmes presencia. Si no hay herramientas o devuelven vacío, explicalo y mezclá con la **GUÍA OPERATIVA** de pantalla.

3) Usá **lista numerada** cuando expliques procedimientos UI. Resaltá controles con **negritas markdown** así: **Cliente**, **Objetivo**, **mes**, **columna del día**, **grilla**, **publicar cronograma**.

4) Incluí rutas cuando ayude: /admin/planificacion, /admin/operaciones.
5) Evitá títulos tipo #; párrafos cortos; sin rollos legales si no pidieron eso.
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
        parts.push('No describas rutas /admin ni flujos de módulos que no estén en esa lista.');
        parts.push(`Sugerencias de ruta conocidas:`);
        readableKeys.slice(0, 12).forEach((k) => {
            const h = cospKnowledge_1.ADMIN_MODULE_ROUTE_HINTS[k];
            if (h)
                parts.push(`- ${k}: ${h}`);
        });
    }
    else if (persona === 'EMPLOYEE') {
        parts.push('Perfil PORTAL EMPLEADO: responder sobre turnos propios, presencia marcada desde portal/ausencias, avisos. No exponer otros empleados por nombre salvo ejemplo genérico. No rutas administrativas salvo mencionar brevemente qué pueden hacer los supervisores en /admin cuando el usuario pregunte cómo reclamar ante la empresa.');
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
function buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled) {
    const guide = (0, cospKnowledge_1.operationalGuideForModuleKey)(moduleKey);
    return [
        `Sos la asistente virtual de COSP (Grupo Bacar). Español Argentina, tono claro y servicial.`,
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
    const systemInstruction = buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled);
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    return runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx);
}
async function runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx) {
    const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
        ...(toolsEnabled
            ? {
                tools: [{ functionDeclarations: assistantToolDeclarations_1.ASSISTANT_FUNCTION_DECLARATIONS }],
                toolConfig: { functionCallingConfig: { mode: generative_ai_1.FunctionCallingMode.AUTO } },
            }
            : {}),
    });
    const chat = model.startChat({ history: historyFiltered });
    let result = await chat.sendMessage(lastUser);
    let rounds = 0;
    while (toolsEnabled && rounds < assistantToolDeclarations_1.ASSISTANT_TOOL_ROUNDS_MAX) {
        rounds++;
        const calls = result.response.functionCalls?.() ?? [];
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
        result = await chat.sendMessage(responseParts);
    }
    const reply = String(result.response.text() ?? '').trim();
    if (!reply) {
        throw new functions.https.HttpsError('internal', 'Respuesta vacía del modelo.');
    }
    return { reply: reply.slice(0, 8000) };
}
//# sourceMappingURL=runPlatformAssistant.js.map