"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULE_HELP_MENUS = exports.QUICK_REPLIES_MARKER_RE = void 0;
exports.parseQuickReplyLabel = parseQuickReplyLabel;
exports.extractQuickRepliesFromText = extractQuickRepliesFromText;
exports.attachQuickRepliesMarker = attachQuickRepliesMarker;
exports.buildModuleHelpMenuReply = buildModuleHelpMenuReply;
exports.QUICK_REPLIES_MARKER_RE = /<!--COSP_QUICK_REPLIES:([\s\S]*?)-->/;
function parseQuickReplyLabel(line) {
    const t = line.trim();
    if (!t)
        return null;
    let m = t.match(/^[·∙•]\s+(.+)$/);
    if (m) {
        const label = m[1].replace(/\*\*/g, '').trim();
        if (label.length >= 3 && label.length <= 110)
            return label;
    }
    m = t.match(/^[-*•∙▪▸►]\s+\*\*([^*]+)\*\*(?:\s*[—–:\-].*)?$/);
    if (m) {
        const label = m[1].trim();
        if (label.length >= 3 && label.length <= 110)
            return label;
    }
    m = t.match(/^\*\*([^*]+)\*\*$/);
    if (m) {
        const label = m[1].trim();
        if (label.length >= 3 && label.length <= 80 && label.split(/\s+/).length <= 10)
            return label;
    }
    m = t.match(/^\d+[.)]\s+\*\*([^*]+)\*\*$/);
    if (m) {
        const label = m[1].trim();
        if (label.length >= 3 && label.length <= 80 && label.split(/\s+/).length <= 8)
            return label;
    }
    m = t.match(/^[-*•∙]\s+([^*\n]{3,90})$/);
    if (m) {
        const label = m[1].trim();
        if (label.length <= 90 && !/[.!?]$/.test(label) && label.split(/\s+/).length <= 12) {
            return label;
        }
    }
    return null;
}
function extractQuickRepliesFromText(content) {
    const withoutMarker = content.replace(exports.QUICK_REPLIES_MARKER_RE, '').trim();
    const lines = withoutMarker.replace(/\r\n/g, '\n').split('\n');
    const seen = new Set();
    const replies = [];
    for (const line of lines) {
        const label = parseQuickReplyLabel(line);
        if (!label)
            continue;
        const key = label.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        replies.push(label);
    }
    return replies;
}
function attachQuickRepliesMarker(reply, replies) {
    const extracted = extractQuickRepliesFromText(reply);
    const merged = [...(replies ?? []), ...extracted];
    const unique = [...new Set(merged.map((r) => r.trim()).filter((r) => r.length >= 2 && r.length <= 120))];
    if (!unique.length)
        return reply.replace(exports.QUICK_REPLIES_MARKER_RE, '').trim();
    const cleaned = reply.replace(exports.QUICK_REPLIES_MARKER_RE, '').trim();
    return `${cleaned}\n\n<!--COSP_QUICK_REPLIES:${JSON.stringify(unique)}-->`;
}
exports.MODULE_HELP_MENUS = {
    PLANNING: {
        intro: 'En **Planificación y Turnos** puedo ayudarte. Tocá una opción:',
        options: [
            'Publicar un cronograma',
            'Automatizar un cronograma',
            'Consultar turnos planificados',
            'Ver empleados sin turnos asignados',
        ],
    },
    PLANNING_AI: {
        intro: 'En **Planificación y Turnos** puedo ayudarte. Tocá una opción:',
        options: [
            'Publicar un cronograma',
            'Automatizar un cronograma',
            'Consultar turnos planificados',
            'Ver empleados sin turnos asignados',
        ],
    },
    OPERATIONS: {
        intro: 'En **Operaciones** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cuántos guardias activos hay ahora?',
            '¿Hay vacantes sin cubrir hoy?',
            '¿Quién faltó hoy?',
            '¿Quién está de franco hoy?',
        ],
    },
    RRHH: {
        intro: 'En **RRHH** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Qué guardias están de vacaciones?',
            '¿Cuántas ausencias hay este mes?',
            'Buscar un colaborador por nombre',
        ],
    },
    CLIENTS: {
        intro: 'En **Clientes y Objetivos** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cuántos clientes activos hay?',
            'Listar clientes de la empresa',
            '¿Qué objetivos tiene un cliente?',
        ],
    },
    SERVICES: {
        intro: 'En **Servicios y SLA** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cuántos SLA vigentes hay?',
            'Horas vendidas vs planificadas de un objetivo',
        ],
    },
    REPORTS: {
        intro: 'En **Reportes y liquidación** puedo ayudarte. Tocá una opción:',
        options: [
            'Resumen de horas de liquidación del mes',
            '¿Cuántas horas realizó un guardia?',
        ],
    },
    ANALYSIS: {
        intro: 'En **Análisis operativo** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cuál es la cobertura real vs SLA este mes?',
            '¿Cuánto ausentismo hubo en los últimos 3 meses?',
        ],
    },
    GUIDE: {
        intro: 'En la **Guía** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cómo completo la guía obligatoria?',
            '¿Qué checklist tengo que marcar?',
            '¿Dónde veo quién terminó el onboarding?',
        ],
    },
    CONFIG: {
        intro: 'En **Configuración** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Qué roles hay configurados?',
            '¿Cómo exijo la guía a un usuario?',
        ],
    },
    DASHBOARD: {
        intro: 'Desde el **Panel** puedo ayudarte. Tocá una opción:',
        options: [
            '¿Cómo estamos hoy operativamente?',
            '¿Cuántos guardias están activos ahora?',
            '¿Hay vacantes sin cubrir hoy?',
        ],
    },
};
function buildModuleHelpMenuReply(moduleKey) {
    const key = String(moduleKey ?? '').trim() || 'DASHBOARD';
    const menu = exports.MODULE_HELP_MENUS[key] || exports.MODULE_HELP_MENUS.DASHBOARD;
    if (!menu)
        return null;
    const bullets = menu.options.map((o) => `- **${o}**`).join('\n');
    const body = `${menu.intro}\n\n${bullets}\n\nTambién podés escribir lo que necesitás.`;
    return attachQuickRepliesMarker(body, menu.options);
}
//# sourceMappingURL=assistantQuickReplies.js.map