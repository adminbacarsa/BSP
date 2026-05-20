"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlatformAssistant = runPlatformAssistant;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
const cospKnowledge_1 = require("./cospKnowledge");
const assistantDataTools_1 = require("./assistantDataTools");
const assistantToolDeclarations_1 = require("./assistantToolDeclarations");
const assistantDeterministicRouter_1 = require("./assistantDeterministicRouter");
const resolveAssistantUser_1 = require("./resolveAssistantUser");
const role_util_1 = require("../common/role.util");
const assistantEmpresaScope_1 = require("./assistantEmpresaScope");
const ASSISTANT_RESPONSE_STYLE = `
Cómo responder (subir calidad sin inventar datos):

0) **Solo base de datos para hechos de esta empresa:** conteos, nombres de personas/clientes/objetivos, listas de turnos, presencias, contratos SLA y cualquier detalle operativo deben salir **exclusivamente** de (A) respuestas de herramientas que en este turno ya leyeron Firestore, o (B) el bloque «MÉTRICAS YA CALCULADAS» (también calculado en backend desde Firestore). Los textos generales sobre COSP (módulos, conceptos, pasos de pantalla) **no** son datos de tu empresa: no infieras cifras ni nombres desde ahí. Si el usuario pide un dato concreto y todavía no hay herramienta que lo devolvió, **llamá la herramienta** antes de afirmar; si no existe herramienta para eso, decí que no podés consultarlo desde acá.

1) **No** abras diciendo en qué ruta o pantalla está el usuario (evitá "Estás en…" o URLs). El chat ya muestra el módulo arriba.

2) **No** incluyas rutas técnicas tipo \`/admin/…\`, \`/empleado/…\` ni \`/cliente/…\` en respuestas normales (incluido listados tipo "qué podés responder" o "qué módulos hay"). Referí al lugar por **nombre del ítem del menú lateral** (p. ej. "Servicios y SLA", "Planificación y Turnos", "Operaciones", "Clientes y Objetivos", "RRHH", "Reportes", "Configuración"). **Solo** si el usuario pregunta explícitamente por la **URL**, la **barra de direcciones** o "en qué link", podés mencionar una ruta concreta.

3) Cumpliendo la regla 0): si al inicio del mensaje de sistema aparece el bloque **MÉTRICAS YA CALCULADAS EN ESTE TURNO**, **usá esas cifras** para SLA del mes u operaciones del día de referencia cuando la pregunta coincida; no inventes otros totales genéricos. Si preguntaron **cantidad exacta** (cuántos, cuántas, número de…): después de datos de herramientas o de ese bloque, **respondé ese número en la primera oración**. Para **horas de un colaborador en un período** (semana, mes, «cuántas hs trabajó») usá **resumen_horas_empleado_periodo** (totales y por código; no es liquidación legal — remití a Reportes si piden noche/feriado/CCT fino). Para **«cuántas horas a planificar»**, **horas vendidas del SLA** o **planificado vs vendidas** de un objetivo/servicio en un mes (también si es seguimiento de un contrato que acabás de nombrar, ej. CASISA - Obrador): usá **resumen_horas_objetivo_sla_periodo** con texto_objetivo o id_objetivo y fecha_referencia en ese mes; respondé con horas_vendidas_sla_mes, horas_ya_planificadas_turnos_mes y horas_pendientes_a_planificar. Para **servicios SLA / «cuántos servicios activos» como en el panel o KPI del mes** usá **contar_servicios_sla_vigentes_empresa** y el campo **cuenta_para_tarjeta_servicios_activos_del_mes** (y **cuenta_objetivos_distintos_con_sla_en_ese_mes** si hablan de objetivos). **Nunca inventes nombres de contratos o SLA**: si listás cuáles son, los textos salen **solo** del array muestra_contratos_en_mes (campos cliente y objetivo) devuelto por esa herramienta; si no alcanza la muestra, decí que hay más y que revisen el módulo Servicios y SLA. Para **«cuántos empleados en nómina/plantilla»** o la tarjeta del panel: **no** des un número ni cites Firestore; indicá la tarjeta **Empleados en nómina** del **Panel principal** o **RRHH y legajos**. Para **quién está de franco o en RET** un día usá **listado_franco_ret_dia**; si necesitás **id_objetivo_cercania** y el usuario dio sólo el nombre del sitio, llamá antes **buscar_objetivos_por_nombre**. Para **buscar persona por nombre** usá **buscar_empleados_por_nombre** con el texto tal cual lo dijo el usuario (nombre y apellido en cualquier orden, o legajo); no exijas «nombre completo» si ya dio apellido y nombre en una sola frase. Para **listado de nombres de la empresa** o «quiénes son los empleados» usá **listado_empleados_empresa** (opcional filtro y solo_activos_nomina_panel). Para lista de guardias por día según Operaciones usá **listado_turnos_operativos_dia**; para totales de presencia **resumen_presencias_objetivos_dia**; empleados concretos: buscar + **consultar_turnos_empleado**. No te limites sólo al tutorial UI si existe herramienta numérica lista.

4) Para procedimientos ("cómo hago…"): **lista numerada** con **doble salto de línea entre pasos** (así queda punto y aparte al renderizar). Párrafos cortos. Resaltá controles con **negritas**: **Cliente**, **Objetivo**, **grilla**, **publicar cronograma**.

5) En resúmenes o varios temas seguidos: **un párrafo o un ítem por bloque**, separados con línea en blanco; no amontones todo en un solo párrafo.

6) Evitá títulos tipo #; sin rollos legales si no pidieron eso.

7) Si una herramienta devuelve \`error\` o \`detalle\`, explicá en español claro qué pasó (permiso, fecha, sin datos). **No** pidas «contactar soporte de IT» ni mensajes genéricos de error técnico si ya tenés el código de error de la herramienta. «hora» y «horas» significan lo mismo para consultas de un colaborador.

8) Si en el hilo anterior listaste un contrato SLA (cliente - objetivo) y el usuario pregunta «cantidad de horas», «cuántas horas», «las horas» o similar, usá **resumen_horas_objetivo_sla_periodo** con el **nombre del objetivo** del mensaje previo y **fecha_referencia** en ese mes (ej. junio → 2026-06-15). Respondé vendidas, planificadas y pendientes; no digas que falta contexto.

8b) Si listaste **varios** contratos (varias líneas «CLIENTE - OBJETIVO») y preguntan **«qué SLA tiene cada uno»**, **horas de cada servicio**, etc.: usá **resumen_horas_sla_varios_objetivos** con **textos_objetivo** (nombre del objetivo de cada línea) o **todos_servicios_activos_mes=true** si piden todos los activos del mes. **Nunca** respondas «inconveniente técnico» o «no puedo consultar» sin haber invocado esa herramienta.

8d) Si ofreciste un **resumen de horas vendidas SLA / planificadas / pendientes** para **todos los objetivos** de un mes y el usuario responde **sí**, **dale**, **ok**: llamá **resumen_horas_sla_varios_objetivos** con **todos_servicios_activos_mes=true** y **fecha_referencia** en ese mes (ej. mayo 2026 → 2026-05-15). Listá vendidas, planificadas y pendientes por objetivo. **No** remitás solo a Servicios/Planificación sin datos.

8e) Si piden **solo CASISA**, **solo los servicios activos de [cliente]** o filtran por cliente: usá **resumen_horas_sla_varios_objetivos** con **texto_cliente** (no todos_servicios_activos_mes). Limitá el resumen a ese cliente (no mezcles Ministerio, Lotería, etc.). Si un nombre de objetivo es ambiguo, pedí el sitio exacto **dentro de ese cliente**.

8c) Para **horas diurnas/nocturnas**, **horas al 100% / FT**, **horas extras**, **liquidación** o **cantidad para liquidar** de un **mes** o de toda la empresa: usá **resumen_horas_liquidacion_empresa_periodo** con **fecha_referencia** en ese mes (ej. mayo → 2026-05-15). Respondé con hs_reales, diurnas, nocturnas, al_100_ft, al_50, plus_feriado. **No** digas que no podés sin llamar la herramienta. **No** uses buscar_empleados_por_nombre para totales de empresa (evitá buscar «horas extras» como persona). **No** uses liquidación para **horas vendidas del SLA** ni **horas del servicio/contrato** — eso es **resumen_horas_objetivo_sla_periodo** o **resumen_horas_sla_varios_objetivos**.

9) Para **«quién tiene turno hoy»**, **«quién trabaja hoy»**, **turnos planificados mañana/ayer** o similar: usá **listado_turnos_operativos_dia** con **fecha** = hoy, mañana (+1 día) o la fecha que indiquen (no asumas «hoy» si dijeron mañana). Agrupá por cliente/objetivo con **código CCT** (M/T/N/F, etc.); no inventes códigos raros (RO, EN) si la tool devuelve otro. Si el módulo es Configuración u otro, igual consultá Firestore si tenés permiso — **no** digas «no hay turnos» sin llamar la herramienta.

9b) Para **«quién está de franco»**, **francos del día**, **código F** o **RET**: usá **listado_franco_ret_dia** (tipo franco o ret según corresponda). Respondé con **resumen_por_objetivo** (cliente, objetivo, lista **empleados** con nombre y apellido). **Nunca** muestres IDs Firestore ni «códigos de legajo» técnicos al usuario. Si el usuario pregunta **«quiénes son»** tras un listado de francos, **volvé a llamar** la herramienta; no repitas IDs del mensaje anterior.

9c) Si piden **detalle de los turnos** (tras hablar de una persona o un mes): usá **consultar_turnos_empleado** con el legajo ya identificado (buscar_empleados si hace falta) y el mismo rango del hilo (ej. mayo). Listá día, código, objetivo y presencia. **Nunca** «inconveniente técnico» ni «contactar soporte IT» sin haber llamado la herramienta.

9d) Para **cuántos clientes** tiene la empresa: **contar_clientes_empresa**. Para **listar nombres** («qué clientes hay», **lista completa**, «los demás», «todos los clientes»): **listado_clientes_empresa** y listá **todos** los de muestra_clientes; no digas «lista completa» si solo mostrás 10. Para **«¿tienen todos los datos completados?»**, clientes incompletos o falta CUIT/contacto: **auditar_completitud_datos_clientes_empresa** (totales completos vs incompletos + campos_faltantes; pasos en **Clientes y Objetivos**). Objetivos/sedes de **un** cliente (ej. CASISA): **listar_objetivos_cliente**. **No** confundas «solo veo 10» con filtro SLA «solo CASISA».

9e) Para **«vigiladores/empleados con más de X horas planificadas»** en un mes (ej. **>200 h en mayo**), **por empleado**: usá **listado_empleados_horas_planificadas_umbral** con **umbral_horas** y **fecha_referencia** en ese mes. Listá nombre, legajo y horas planificadas de cobertura. **No** uses resumen_horas_liquidacion_empresa_periodo (bolsa 200 / fichadas) ni SLA de objetivo. **No** interpretes «200hs» como nombre de sitio. Si piden **detalle de los empleados** tras esa consulta, repetí la misma tool con el umbral del hilo.

9f) Para **«a qué colaboradores no les planifiqué turno»**, **sin turnos en el mes** o **quién no tiene nada en la grilla**: usá **listado_empleados_sin_turnos_planificados** (mes del hilo o actual). Listá muestra_empleados_sin_turno; no digas que no hay tool ni remitas solo a Planificación si la tool devolvió datos.

9g) Para **«cómo publico un cronograma»** (desde cualquier módulo): pasos numerados en **Planificación y Turnos** (Cliente, Objetivo, mes, grilla, **Publicar cronograma**). No respondas solo con menú genérico de módulos.

10) **Nunca** le digas al usuario que estás «llamando», «esperando» o «consultando» una herramienta, ni muestres nombres técnicos de tools ni JSON de parámetros. Las herramientas se ejecutan en el servidor en el mismo turno: o invocás la función (function call) y respondés con el resultado, o no afirmes datos. Si el usuario pregunta «no hay nadie?» tras turnos de hoy, respondé con el listado o el total, no con «todavía espero».

11) **Reportes y análisis:** para exportes, liquidación y columnas de reportes orientá a **Reportes y liquidación**; para métricas agregadas a **Análisis operativo**. El chat puede dar **totales y listas** vía herramientas (turnos, SLA, horas por persona, presencias del día); no reemplaza cada pantalla de exportación. Si piden algo que no tiene herramienta, decilo y indicá el módulo correcto.
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
function normalizeClientDeploy(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    const env = o.environment === 'emulator' || o.environment === 'production' ? o.environment : null;
    const versionLabel = String(o.versionLabel ?? '').trim().slice(0, 200);
    if (!env || !versionLabel)
        return null;
    return {
        environment: env,
        versionLabel,
        buildHash: String(o.buildHash ?? '').trim().slice(0, 32) || undefined,
        buildTime: String(o.buildTime ?? '').trim().slice(0, 32) || undefined,
        firebaseProjectId: String(o.firebaseProjectId ?? '').trim().slice(0, 64) || undefined,
    };
}
function buildDeployContextBlock(clientDeploy) {
    const fnEmu = process.env.FUNCTIONS_EMULATOR === 'true';
    const fnLine = fnEmu
        ? 'Backend asistente: Firebase Functions en EMULADOR local (puerto 5001).'
        : 'Backend asistente: Firebase Functions en PRODUCCIÓN (Google Cloud, proyecto desplegado).';
    if (!clientDeploy) {
        return `${fnLine}\nFront: entorno no informado por el cliente.`;
    }
    const frontLine = clientDeploy.environment === 'emulator'
        ? 'Front: LAB LOCAL — Next.js conectado a emuladores Auth/Firestore/Functions (datos de prueba, no producción).'
        : 'Front: PRODUCCIÓN — hosting Firebase (datos reales de la empresa en Firestore prod).';
    const parts = [
        frontLine,
        fnLine,
        `Versión/build declarada por el cliente: "${clientDeploy.versionLabel}".`,
    ];
    if (clientDeploy.buildHash)
        parts.push(`Commit/build hash cliente: ${clientDeploy.buildHash}.`);
    if (clientDeploy.buildTime)
        parts.push(`Build cliente: ${clientDeploy.buildTime}.`);
    if (clientDeploy.firebaseProjectId)
        parts.push(`Proyecto Firebase (cliente): ${clientDeploy.firebaseProjectId}.`);
    parts.push('Si preguntan "¿en qué versión estoy?", "¿es emulador o producción?" o similar: respondé con estas líneas verificadas; no inventes otro entorno.');
    return parts.join('\n');
}
function buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled, metricsVerifiedBlock, deployContextBlock) {
    const guide = (0, cospKnowledge_1.operationalGuideForModuleKey)(moduleKey);
    return [
        `Sos la asistente virtual de COSP (Grupo Bacar). Español Argentina, tono claro y servicial.`,
        metricsVerifiedBlock ? `${metricsVerifiedBlock}\n` : '',
        deployContextBlock ? `ENTORNO Y VERSIÓN (verificado):\n${deployContextBlock}\n` : '',
        ASSISTANT_RESPONSE_STYLE,
        '',
        cospKnowledge_1.COSP_PLATFORM_KNOWLEDGE,
        guide ? `\n${guide}` : '',
        '',
        `HERRAMIENTAS servidor (solo si el cliente mostró empresa válida + permiso):`,
        toolsEnabled
            ? `Activadas sólo lectura Firestore de la empresa actual: los hechos concretos de la empresa vienen únicamente de esas consultas (y del bloque de métricas precalculadas en el prompt). Interpretá «hoy» como fechaReferenciaCliente=${referenceYsMmDd} cuando el usuario no precise otra fecha.`
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
async function runPlatformAssistant(uid, payload, opts) {
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
    const profile = await (0, resolveAssistantUser_1.resolveAssistantUser)(uid, { tokenRole: opts?.tokenRole });
    if (!profile) {
        throw new functions.https.HttpsError('permission-denied', 'Tu cuenta no está asociada a usuarios COSP conocidos para el asistente.');
    }
    if (!profile.canUseAssistant) {
        if ((0, role_util_1.isSuperAdminRole)(opts?.tokenRole) || profile.isSuperAdmin) {
            profile.canUseAssistant = true;
            profile.isSuperAdmin = true;
        }
        else {
            throw new functions.https.HttpsError('permission-denied', 'Tu rol no tiene permiso para usar el asistente virtual. Pedí acceso al módulo «Asistente IA» en Configuración → Roles.');
        }
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
    const clientDeploy = normalizeClientDeploy(payload.clientDeploy);
    const deployContextBlock = buildDeployContextBlock(clientDeploy);
    let scopeEmpresa = false;
    if (empresaForTools.trim()) {
        const scopeInfo = await (0, assistantEmpresaScope_1.resolveAssistantEmpresaScope)(admin.firestore(), empresaForTools);
        scopeEmpresa = scopeInfo.scopeEmpresa;
    }
    const toolCtx = {
        persona: profile.persona,
        empresaId: empresaForTools,
        scopeEmpresa,
        readableModuleKeys: profile.readableModuleKeys,
        selfEmployeeFirestoreId: selfEmployeeId,
        referenceDateYsMmDd: referenceYsMmDd,
    };
    const toolsEnabled = (0, assistantDataTools_1.assistantToolsEnabledForContext)(toolCtx);
    if (toolsEnabled && profile.persona === 'SYSTEM' && empresaForTools.trim()) {
        try {
            const direct = await (0, assistantDeterministicRouter_1.tryDeterministicDataReply)(lastUser, toolCtx, toolsEnabled, moduleKey, pathname, priorRaw.map((m) => ({ role: m.role, content: m.content })));
            if (direct?.trim())
                return { reply: direct.trim() };
        }
        catch (e) {
            console.warn('[assistant] tryDeterministicDataReply', e);
        }
    }
    let metricsVerifiedBlock = '';
    const recentForPrefetch = priorRaw.map((m) => ({ role: m.role, content: m.content }));
    if (toolsEnabled &&
        profile.persona === 'SYSTEM' &&
        empresaForTools.trim() &&
        (0, assistantDeterministicRouter_1.shouldPrefetchMetricsSnapshot)(lastUser, moduleKey, recentForPrefetch)) {
        try {
            metricsVerifiedBlock = await (0, assistantDataTools_1.buildEmpresaMetricsSnapshotForPrompt)(toolCtx, {
                includeOperationsDay: (0, assistantDeterministicRouter_1.shouldPrefetchOperationsMetricsInSnapshot)(lastUser),
            });
        }
        catch (e) {
            console.warn('[assistant] buildEmpresaMetricsSnapshotForPrompt', e);
        }
    }
    const systemInstruction = buildSystemPrompt(profile, pathname, moduleKey, referenceYsMmDd, toolsEnabled, metricsVerifiedBlock || undefined, deployContextBlock);
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    return runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx, recentForPrefetch, moduleKey, pathname);
}
function normAssistantText(s) {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}
function looksLikeFakeToolNarration(text) {
    const t = normAssistantText(text);
    return ((/\b(esperando|llamando|voy a consultar|parametros|parámetros)\b/.test(t) &&
        /\b(herramienta|listado_turnos|function|tool)\b/.test(t)) ||
        /\blistado_turnos_operativos_dia\b/.test(t));
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
async function runGeminiAssistantChat(genAI, systemInstruction, toolsEnabled, historyFiltered, lastUser, toolCtx, recentMessages = [], moduleKey = null, pathname = '/') {
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
    if (reply && toolsEnabled && (0, assistantDeterministicRouter_1.looksLikeFalseEmptyTurnosReply)(reply)) {
        try {
            const recovered = await (0, assistantDeterministicRouter_1.tryDeterministicDataReply)(lastUser, toolCtx, true, moduleKey, pathname, recentMessages);
            if (recovered?.trim())
                return { reply: recovered.trim() };
        }
        catch (e) {
            console.warn('[assistant] recover false empty turnos', e);
        }
    }
    if (reply && toolsEnabled && looksLikeFakeToolNarration(reply)) {
        try {
            const recovered = await (0, assistantDeterministicRouter_1.tryDeterministicDataReply)(lastUser, toolCtx, true, moduleKey, pathname, recentMessages);
            if (recovered?.trim())
                return { reply: recovered.trim() };
        }
        catch (e) {
            console.warn('[assistant] recover fake tool narration', e);
        }
        try {
            result = await chat.sendMessage('Respondé al usuario en español con datos concretos. Invocá la herramienta necesaria (function call); no digas que estás esperando ni nombres de tools.');
            reply = extractAssistantTextSafe(result.response);
        }
        catch (e) {
            console.warn('[assistant] retry tras narración falsa', mapGeminiErrorToHint(e));
        }
    }
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