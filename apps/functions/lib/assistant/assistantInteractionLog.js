"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replyShowsFirestoreEmployeeIds = replyShowsFirestoreEmployeeIds;
exports.classifyAssistantOutcome = classifyAssistantOutcome;
exports.writeAssistantInteractionLog = writeAssistantInteractionLog;
exports.extractLastUserQuestion = extractLastUserQuestion;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = 'assistant_interaction_logs';
const UNSATISFIED_REPLY_PATTERNS = [
    /\binconveniente\s+t[eé]cnico\b/i,
    /\bno\s+puedo\s+consultar\b/i,
    /\bno\s+est[aá]\s+disponible\b/i,
    /\bcontact(ar|e)\s+.{0,24}(soporte|it|t[eé]cnico)\b/i,
    /\bavis[aá]\s+.{0,20}(soporte|it)\b/i,
    /\berror\s+t[eé]cnico\b/i,
    /\bno\s+se\s+pudo\s+conectar\b/i,
    /\bfallo\s+interno\b/i,
    /\bservicio\s+temporalmente\s+no\s+disponible\b/i,
    /\bno\s+tengo\s+permiso\b/i,
    /\bno\s+pude\s+completar\b/i,
    /\bno\s+pude\s+listar\b/i,
    /\bno\s+pude\s+consultar\b/i,
    /\bno\s+puedo\s+darte\b/i,
    /\bsuger(i|í)\s+consultar\s+el\s+m[oó]dulo\b/i,
    /\brevis[aá]\s+el\s+m[oó]dulo\s+de\s+\*\*reportes\*\*/i,
    /\bcontact(ar|e)\s+.{0,24}(soporte|it)\b/i,
    /\b(soporte|equipo)\s+de\s+it\b/i,
    /\bintent[aá]\s+nuevamente\s+m[aá]s\s+tarde\b/i,
    /\bnecesito consultar la informaci[oó]n\b/i,
    /\bse encuentra disponible en el m[oó]dulo\b/i,
    /\best[aá] disponible en el m[oó]dulo de\b/i,
    /\b(pod[eé]s|puede)\s+(ver|consultar|revisar)\s+.{0,40}m[oó]dulo\b/i,
    /\b(dirigite|dir[ií]gete|acced[eé])\s+.{0,32}m[oó]dulo\b/i,
    /\bno\s+(encontr[eé]|localic[eé]|identifiqu[eé])\b/i,
    /\bsin\s+coincidencias\b/i,
    /\bno\s+hay\s+datos\b/i,
    /\bno\s+disponemos\b/i,
    /^⚠️/,
];
const ID_BLOCKLIST = /^(firestore|ministerio|casisa|loteria|lotería|configuracion|planificacion|operaciones|colaboradores)$/i;
function replyShowsFirestoreEmployeeIds(reply) {
    if (!/\b(franco|ret|empleado|guardia|legajo|turno|colaborador)\b/i.test(reply))
        return false;
    const ids = reply.match(/\b[a-zA-Z][a-zA-Z0-9]{9,21}\b/g) ?? [];
    const suspicious = ids.filter((id) => !ID_BLOCKLIST.test(id) && !/MISERICORDIA/i.test(id));
    if (suspicious.length >= 2)
        return true;
    if (suspicious.length >= 1 && /\b(franco|ret)\b/i.test(reply))
        return true;
    return false;
}
function classifyAssistantOutcome(reply, hadError) {
    if (hadError)
        return 'error';
    const r = String(reply ?? '').trim();
    if (!r)
        return 'unsatisfied';
    for (const re of UNSATISFIED_REPLY_PATTERNS) {
        if (re.test(r))
            return 'unsatisfied';
    }
    if (replyShowsFirestoreEmployeeIds(r))
        return 'unsatisfied';
    if (r.length < 28 && /\bno\s+(puedo|podemos|hay)\b/i.test(r))
        return 'unsatisfied';
    return 'answered';
}
function clip(s, max) {
    const t = String(s ?? '').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
async function writeAssistantInteractionLog(input) {
    const question = clip(input.question, 2000);
    if (question.length < 2)
        return;
    const empresaId = String(input.empresaId ?? '').trim() || '_sin_empresa';
    try {
        await admin.firestore().collection(COLLECTION).add({
            empresaId,
            uid: String(input.uid ?? '').slice(0, 128),
            userEmail: input.userEmail ? clip(input.userEmail, 320) : null,
            question,
            reply: input.reply != null ? clip(input.reply, 4000) : null,
            moduleKey: input.moduleKey ? clip(input.moduleKey, 64) : null,
            pathname: input.pathname ? clip(input.pathname, 400) : null,
            outcome: input.outcome,
            needsReview: input.outcome === 'unsatisfied' || input.outcome === 'error',
            errorCode: input.errorCode ? clip(input.errorCode, 64) : null,
            errorMessage: input.errorMessage ? clip(input.errorMessage, 480) : null,
            durationMs: typeof input.durationMs === 'number' ? Math.round(input.durationMs) : null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[assistant] writeAssistantInteractionLog', msg.slice(0, 200));
    }
}
function extractLastUserQuestion(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user')
            return String(messages[i]?.content ?? '').trim();
    }
    return '';
}
//# sourceMappingURL=assistantInteractionLog.js.map