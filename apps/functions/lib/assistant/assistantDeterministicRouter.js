"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryDeterministicDataReply = tryDeterministicDataReply;
const assistantDataTools_1 = require("./assistantDataTools");
function normText(s) {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}
function shouldSkipDeterministicRouter(raw) {
    const t = normText(raw);
    if (raw.length > 240)
        return true;
    if (/\b(quien|quién|listado|lista|mostrame|mostrá|mostrar|nombres de|cual|cuáles|decime todos)\b/.test(t))
        return true;
    if (/\b(cómo|como|donde|dónde|por que|por qué|paso a paso|tutorial|explic)\b/.test(t))
        return true;
    return false;
}
function employeeCountLooksGlobalOnly(t) {
    if (/\ben\s+(el|los|la|las)\s+[^.\n?]{5,}/.test(t)) {
        if (/\b(nomina|nómina|plantilla|empresa|total)\b/.test(t))
            return true;
        return false;
    }
    return true;
}
function matchEmployeeCountIntent(t, moduleKey, pathname) {
    if (!employeeCountLooksGlobalOnly(t))
        return false;
    const rrhhCtx = moduleKey === 'RRHH' || moduleKey === 'DASHBOARD' || /rrhh/i.test(pathname);
    if (/\b(cuántos|cuantos)\s+(somos|tenemos|hay)\b/.test(t) && rrhhCtx)
        return true;
    if (rrhhCtx &&
        /\b(cuántos|cuantos)\b/.test(t) &&
        /\b(somos|tenemos)\b/.test(t) &&
        /\b(empleados|vigiladores|personal|legajos|guardias)\b/.test(t)) {
        return true;
    }
    if (/\b(cuántos|cuantos|cuántas|cuantas|numero|número|total)\b/.test(t) &&
        /\b(empleados|empleado|vigiladores|vigilador|legajos|legajo|personal|guardias|guardia)\b/.test(t)) {
        return true;
    }
    if (/\b(empleados|vigiladores|legajos)\s+en\s+(nómina|nomina|plantilla)\b/.test(t) &&
        /\b(cuántos|cuantos|cuántas|cuantas|cuanto|cuánto|numero|número|total)\b/.test(t)) {
        return true;
    }
    return false;
}
function matchSlaCountIntent(t) {
    if (!/\b(servicios|contratos)\b/.test(t))
        return false;
    if (/\b(cuántos|cuantos|cuántas|cuantas|numero|número|total|cuanto|cuánto|hay|tenemos)\b/.test(t) ||
        /\b(servicios|contratos).{0,48}\b(hay|tenemos|cuántos|cuantos)\b/.test(t)) {
        return true;
    }
    return false;
}
function matchOpsDayAggregateIntent(t) {
    if (/\b(quien|quién|franco|ret\b|reten|listado|lista|cercan|proxim)\b/.test(t))
        return false;
    if (/\b(presentes|ausentes)\b/.test(t) && /\b(hoy|el dia|el día|dia de|día de|este dia|este día)\b/.test(t))
        return true;
    if (/\b(resumen)\b.{0,24}\b(operaciones|turnos)\b/.test(t) && !/\b(por objetivo|cada objetivo)\b/.test(t))
        return true;
    if (/\bturnos visibles\b/.test(t) && /\b(cuántos|cuantos|cuanto|cuánto|numero|número)\b/.test(t))
        return true;
    return false;
}
async function tryDeterministicDataReply(lastUser, toolCtx, toolsEnabled, moduleKey, pathname) {
    if (!toolsEnabled || toolCtx.persona !== 'SYSTEM' || !toolCtx.empresaId.trim())
        return null;
    const raw = lastUser.trim();
    if (!raw || shouldSkipDeterministicRouter(raw))
        return null;
    const t = normText(raw);
    const mk = typeof moduleKey === 'string' && moduleKey.trim() ? moduleKey.trim() : null;
    const wantEmp = matchEmployeeCountIntent(t, mk, pathname);
    const wantSla = matchSlaCountIntent(t);
    const wantOps = matchOpsDayAggregateIntent(t);
    if (!wantEmp && !wantSla && !wantOps)
        return null;
    const blocks = [];
    if (wantEmp) {
        const r = await (0, assistantDataTools_1.ejecutarContarEmpleadosPlantillaEmpresa)(toolCtx, {});
        if (String(r.error ?? '').trim()) {
            if (!wantSla && !wantOps)
                return null;
        }
        else {
            const panel = Number(r.cuenta_para_tarjeta_panel_empleados_nomina ?? 0);
            const amplio = Number(r.cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado ?? 0);
            let b = `Según **Firestore** (colección **empleados**, misma regla que la tarjeta **EMPLEADOS EN NÓMINA** del panel), hay **${panel}** legajos con estado activo explícito.`;
            if (amplio !== panel || /\b(todos|amplio|lista|rrhh|sin estado|incluye)\b/.test(t)) {
                b += `\n\nCon el criterio amplio de lista RRHH (incluye legajos sin estado o no dados de baja explícita), **${amplio}**.`;
            }
            if (r.truncado_loteFirestore_900) {
                b += `\n\n*Nota:* la consulta alcanzó el límite de 900 documentos en Firestore; si hay más legajos, el conteo puede estar incompleto.`;
            }
            blocks.push(b);
        }
    }
    if (wantSla) {
        const r = await (0, assistantDataTools_1.ejecutarContarServiciosSlaVigentesEmpresa)(toolCtx, {});
        if (String(r.error ?? '').trim()) {
            if (!wantEmp && !blocks.length && !wantOps)
                return null;
        }
        else {
            const n = Number(r.cuenta_para_tarjeta_servicios_activos_del_mes ?? 0);
            const obj = Number(r.cuenta_objetivos_distintos_con_sla_en_ese_mes ?? 0);
            const fecha = String(r.fecha_referencia ?? toolCtx.referenceDateYsMmDd);
            blocks.push(`Según **Firestore** (colección **servicios_sla**, contratos cuyo período solapa el mes de la fecha de referencia **${fecha}**, alineado al KPI del módulo Servicios y SLA), hay **${n}** contratos.\n\nObjetivos distintos con SLA en ese mes: **${obj}**.`);
        }
    }
    if (wantOps) {
        const r = await (0, assistantDataTools_1.ejecutarResumenPresenciasObjetivosDia)(toolCtx, {});
        if (String(r.error ?? '').trim()) {
            if (blocks.length === 0)
                return null;
        }
        else {
            const tot = r.totales;
            if (!tot) {
                if (blocks.length === 0)
                    return null;
            }
            else {
                const fecha = String(r.fecha_referencia ?? toolCtx.referenceDateYsMmDd);
                blocks.push(`Según **Firestore** (turnos visibles como en **Operaciones** para **${fecha}**, zona Argentina/Córdoba): **${tot.turnos_visibles_en_dia ?? 0}** turnos visibles; **${tot.presentes ?? 0}** presentes, **${tot.ausentes ?? 0}** ausentes, **${tot.sin_marcacion_relevante ?? 0}** sin marcación relevante.`);
            }
        }
    }
    if (blocks.length === 0)
        return null;
    const reply = blocks.join('\n\n---\n\n');
    console.info('[assistant] deterministic data reply', { wantEmp, wantSla, wantOps, chars: reply.length });
    return reply.slice(0, 7500);
}
//# sourceMappingURL=assistantDeterministicRouter.js.map