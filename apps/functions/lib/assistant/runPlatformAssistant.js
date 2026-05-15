"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlatformAssistant = runPlatformAssistant;
const functions = require("firebase-functions");
const generative_ai_1 = require("@google/generative-ai");
const cospKnowledge_1 = require("./cospKnowledge");
const resolveAssistantUser_1 = require("./resolveAssistantUser");
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
function buildSystemPrompt(profile, pathname, moduleKey) {
    return [
        `Sos la asistente virtual de COSP (Grupo Bacar). Sé concisa en español (Argentina); sin markdown excesivo; listas sólo cuando ayuden.`,
        '',
        cospKnowledge_1.COSP_PLATFORM_KNOWLEDGE,
        '',
        `Contexto servidor (verificado por backend):`,
        `- Perfil efectivo: ${profile.summaryLabel} (${profile.persona})`,
        `- Ruta navegador (orientativa): "${pathname}"`,
        '',
        personaModuleBlurb(profile.persona, profile.readableModuleKeys, moduleKey || undefined),
        '',
        `Reglas: No inventás convocatorias APIs internas nuevas ni prometés ejecutar cambios sobre datos.`,
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
    const systemInstruction = buildSystemPrompt(profile, pathname, moduleKey);
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash',
        systemInstruction,
    });
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
    const chat = model.startChat({ history: historyFiltered });
    const result = await chat.sendMessage(lastUser);
    const reply = String(result.response.text() ?? '').trim();
    if (!reply) {
        throw new functions.https.HttpsError('internal', 'Respuesta vacía del modelo.');
    }
    return { reply: reply.slice(0, 8000) };
}
//# sourceMappingURL=runPlatformAssistant.js.map