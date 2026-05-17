"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT = void 0;
exports.ejecutarListadoFrancoRetDia = ejecutarListadoFrancoRetDia;
exports.assistantToolsEnabledForContext = assistantToolsEnabledForContext;
exports.resolveSelfEmployeeFirestoreId = resolveSelfEmployeeFirestoreId;
exports.ejecutarBuscarEmpleadosPorNombre = ejecutarBuscarEmpleadosPorNombre;
exports.ejecutarListadoEmpleadosEmpresa = ejecutarListadoEmpleadosEmpresa;
exports.ejecutarBuscarObjetivosPorNombre = ejecutarBuscarObjetivosPorNombre;
exports.ejecutarConsultarTurnosEmpleado = ejecutarConsultarTurnosEmpleado;
exports.ejecutarResumenHorasEmpleadoPeriodo = ejecutarResumenHorasEmpleadoPeriodo;
exports.ejecutarResumenPresenciasObjetivosDia = ejecutarResumenPresenciasObjetivosDia;
exports.ejecutarListadoTurnosOperativosDia = ejecutarListadoTurnosOperativosDia;
exports.ejecutarContarServiciosSlaVigentesEmpresa = ejecutarContarServiciosSlaVigentesEmpresa;
exports.ejecutarResumenHorasObjetivoSlaPeriodo = ejecutarResumenHorasObjetivoSlaPeriodo;
exports.ejecutarResumenHorasSlaVariosObjetivos = ejecutarResumenHorasSlaVariosObjetivos;
exports.ejecutarContarEmpleadosPlantillaEmpresa = ejecutarContarEmpleadosPlantillaEmpresa;
exports.buildEmpresaMetricsSnapshotForPrompt = buildEmpresaMetricsSnapshotForPrompt;
exports.dispatchAssistantToolCall = dispatchAssistantToolCall;
const admin = require("firebase-admin");
const assistantSlaHours_1 = require("./assistantSlaHours");
const AR_DAY_OFFSET = '-03:00';
exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT = 900;
function norm(s) {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}
function buildEmpleadoSearchHaystack(data) {
    const ln = String(data.lastName ?? '').trim();
    const fn = String(data.firstName ?? '').trim();
    const nameRaw = String(data.name ?? '').trim().replace(/,/g, ' ');
    const nom = String(data.nombre ?? '').trim().replace(/,/g, ' ');
    const leg = String(data.fileNumber ?? '').trim();
    const chunks = [ln, fn, nameRaw, nom, leg].filter(Boolean);
    const joined = chunks.join(' ').replace(/\s+/g, ' ');
    return norm(joined);
}
function matchesEmpleadoSearchNeedle(needle, haystack) {
    if (!needle || !haystack)
        return false;
    if (haystack.includes(needle))
        return true;
    const tokens = needle.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length < 2)
        return false;
    return tokens.every((t) => haystack.includes(t));
}
function canUseEmployeeSearch(ctx) {
    if (ctx.persona !== 'SYSTEM')
        return false;
    return ctx.readableModuleKeys.some((k) => ['RRHH', 'PLANNING', 'OPERATIONS', 'REPORTS', 'ANALYSIS', 'CONFIG', 'SERVICES'].includes(k));
}
function canQueryShifts(ctx) {
    if (ctx.persona === 'CLIENT')
        return false;
    if (ctx.persona === 'EMPLOYEE')
        return !!ctx.selfEmployeeFirestoreId;
    return ctx.readableModuleKeys.some((k) => ['OPERATIONS', 'PLANNING', 'REPORTS', 'ANALYSIS', 'DASHBOARD', 'RRHH'].includes(k));
}
function canQueryOperationsDaySummary(ctx) {
    if (ctx.persona !== 'SYSTEM')
        return false;
    if (!ctx.empresaId.trim())
        return false;
    return ctx.readableModuleKeys.some((k) => ['OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'REPORTS', 'PLANNING'].includes(k));
}
function canQueryServiciosSlaResumen(ctx) {
    if (ctx.persona !== 'SYSTEM')
        return false;
    if (!ctx.empresaId.trim())
        return false;
    return ctx.readableModuleKeys.some((k) => ['SERVICES', 'PLANNING', 'OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'CONFIG', 'CLIENTS'].includes(k));
}
function canSearchObjectivesCrm(ctx) {
    if (ctx.persona !== 'SYSTEM')
        return false;
    if (!ctx.empresaId.trim())
        return false;
    return ctx.readableModuleKeys.some((k) => ['CLIENTS', 'PLANNING', 'OPERATIONS', 'SERVICES', 'ANALYSIS', 'DASHBOARD', 'REPORTS', 'CONFIG'].includes(k));
}
function canQueryEmpleadosPlantillaResumen(ctx) {
    if (ctx.persona !== 'SYSTEM')
        return false;
    if (!ctx.empresaId.trim())
        return false;
    return ctx.readableModuleKeys.some((k) => ['RRHH', 'PLANNING', 'OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'CONFIG', 'REPORTS'].includes(k));
}
function ymCordoba(dt) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: 'numeric',
    }).formatToParts(dt);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    return `${y}_${m}`;
}
function isSameCordobaCalendarDay(dt, ymdHyphen) {
    const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(dt);
    return s === ymdHyphen;
}
function monitorWideWindow(referenceYsMmDd) {
    parseYmd(referenceYsMmDd);
    const dNoonMs = Date.parse(`${referenceYsMmDd}T12:00:00.000${AR_DAY_OFFSET}`);
    const dEndMs = Date.parse(`${referenceYsMmDd}T23:59:59.999${AR_DAY_OFFSET}`);
    const startMs = dNoonMs - 86400000;
    const endMs = dEndMs + 86400000;
    return {
        start: admin.firestore.Timestamp.fromMillis(startMs),
        end: admin.firestore.Timestamp.fromMillis(endMs),
    };
}
function horaHmCordoba(dt) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Argentina/Cordoba',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(dt);
}
async function queryTurnosVisiblesOperacionesEmpresaDia(db, objectiveMap, fecha) {
    const objectiveIds = new Set(objectiveMap.keys());
    const { start, end } = monitorWideWindow(fecha);
    let qsnap;
    try {
        qsnap = await db
            .collection('turnos')
            .where('startTime', '>=', start)
            .where('startTime', '<=', end)
            .limit(exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT)
            .get();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[assistant] queryTurnosVisiblesOperacionesEmpresaDia', { fecha, msg });
        throw new Error(`error_consulta_turnos_operaciones: ${msg.slice(0, 240)}`);
    }
    const pre = [];
    const pubDocKeys = new Set();
    for (const docSnap of qsnap.docs) {
        const shift = docSnap.data();
        const st = readFirestoreTs(shift, 'startTime');
        if (!st)
            continue;
        const shiftDateObj = st.toDate();
        if (!isSameCordobaCalendarDay(shiftDateObj, fecha))
            continue;
        const oid = String(shift.objectiveId ?? '').trim();
        if (!oid || !objectiveIds.has(oid))
            continue;
        if (shift.draft === true)
            continue;
        if (shift.status === 'COVERED')
            continue;
        const rawPos = String(shift.positionName ?? '').trim();
        if (!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General')
            continue;
        const isOp = shift.origin === 'RETEN' ||
            shift.origin === 'OPERATIONS_COVERAGE' ||
            shift.origin === 'SLA_VIRTUAL' ||
            !!shift.isReten ||
            shift.resolvedBy === 'OPERACIONES';
        const isAlreadyProcessed = !!shift.isPresent ||
            shift.status === 'PRESENT' ||
            shift.status === 'COMPLETED' ||
            !!shift.isReportedToPlanning ||
            !!shift.isReported;
        const empId = String(shift.employeeId ?? '');
        const isValidEmployee = !!(empId && empId !== 'VACANTE');
        const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
        const isUnassigned = !isValidEmployee;
        if (isUnassigned && !isReportedToPlanning)
            continue;
        const needsPubCheck = !isOp && !isAlreadyProcessed;
        if (needsPubCheck) {
            pubDocKeys.add(`${oid}_${ymCordoba(shiftDateObj)}`);
        }
        const isAbsent = !!shift.isAbsent;
        const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent;
        const meta = objectiveMap.get(oid);
        const nombreEmp = String(shift.employeeName ?? '').trim();
        const empleado_etiqueta = isValidEmployee ? nombreEmp || empId.slice(0, 12) || '(legajo)' : 'VACANTE / sin asignar';
        pre.push({
            oid,
            needsPubCheck,
            shiftDateObj,
            isPresent,
            isAbsent,
            codigo: String(shift.code ?? shift.type ?? '').trim() || '—',
            puesto: rawPos,
            empleado_etiqueta,
            cliente: (meta?.clientName ?? String(shift.clientName ?? '').trim()) || '—',
            objetivo_nombre: (meta?.name ?? String(shift.objectiveName ?? '').trim()) || oid,
            h_inicio_cordoba: horaHmCordoba(shiftDateObj),
        });
    }
    const pubMap = new Map();
    const refs = Array.from(pubDocKeys).map((k) => db.collection('planificacion_estados').doc(k));
    const snaps = await firestoreGetAllRefs(db, refs);
    for (let j = 0; j < snaps.length; j++) {
        pubMap.set(refs[j].id, snaps[j].exists);
    }
    const rows = [];
    for (const c of pre) {
        if (c.needsPubCheck) {
            const k = `${c.oid}_${ymCordoba(c.shiftDateObj)}`;
            if (!pubMap.get(k))
                continue;
        }
        rows.push({
            oid: c.oid,
            isPresent: c.isPresent,
            isAbsent: c.isAbsent,
            codigo: c.codigo,
            puesto: c.puesto,
            empleado_etiqueta: c.empleado_etiqueta,
            cliente: c.cliente,
            objetivo_nombre: c.objetivo_nombre,
            h_inicio_cordoba: c.h_inicio_cordoba,
            shiftTsMs: c.shiftDateObj.getTime(),
        });
    }
    rows.sort((a, b) => {
        const c0 = `${a.cliente} ${a.objetivo_nombre}`.localeCompare(`${b.cliente} ${b.objetivo_nombre}`, 'es');
        if (c0 !== 0)
            return c0;
        return a.shiftTsMs - b.shiftTsMs;
    });
    const outMapped = rows.map(({ shiftTsMs, ...rest }) => rest);
    return { rows: outMapped, truncadoConsultaTurnos: qsnap.size >= exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT };
}
async function objectivesMapForEmpresa(db, empresaId, filterObjectiveId) {
    const out = new Map();
    const filt = filterObjectiveId?.trim();
    const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(480).get();
    for (const d of snap.docs) {
        const data = d.data();
        const clientName = String(data.name ?? '').trim() || d.id;
        const objetivos = data.objetivos;
        if (Array.isArray(objetivos)) {
            for (const o of objetivos) {
                const oid = String(o?.id ?? '').trim();
                if (!oid)
                    continue;
                if (filt && oid !== filt)
                    continue;
                const name = String(o?.name ?? '').trim() || oid;
                out.set(oid, { name, clientId: d.id, clientName });
            }
        }
        else if (!objetivos) {
            if (filt && d.id !== filt)
                continue;
            out.set(d.id, {
                name: clientName,
                clientId: d.id,
                clientName,
            });
        }
    }
    return out;
}
async function objectivesMapWithCoordsForEmpresa(db, empresaId, filterObjectiveId) {
    const out = new Map();
    const filt = filterObjectiveId?.trim();
    const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(480).get();
    for (const d of snap.docs) {
        const data = d.data();
        const clientName = String(data.name ?? '').trim() || d.id;
        const objetivos = data.objetivos;
        const readLatLng = (o) => {
            const lat = o?.lat != null ? Number(o.lat) : NaN;
            const lng = o?.lng != null ? Number(o.lng) : NaN;
            return {
                lat: Number.isFinite(lat) ? lat : null,
                lng: Number.isFinite(lng) ? lng : null,
            };
        };
        if (Array.isArray(objetivos)) {
            for (const o of objetivos) {
                const oid = String(o?.id ?? '').trim();
                if (!oid)
                    continue;
                if (filt && oid !== filt)
                    continue;
                const name = String(o?.name ?? '').trim() || oid;
                const { lat, lng } = readLatLng(o);
                out.set(oid, { name, clientId: d.id, clientName, lat, lng });
            }
        }
        else if (!objetivos) {
            if (filt && d.id !== filt)
                continue;
            const lat = data.lat != null ? Number(data.lat) : NaN;
            const lng = data.lng != null ? Number(data.lng) : NaN;
            out.set(d.id, {
                name: clientName,
                clientId: d.id,
                clientName,
                lat: Number.isFinite(lat) ? lat : null,
                lng: Number.isFinite(lng) ? lng : null,
            });
        }
    }
    return out;
}
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
async function collectFrancoRetTurnosDia(db, objectiveMap, fecha, tipo) {
    const { start, end } = monitorWideWindow(fecha);
    const qsnap = await db
        .collection('turnos')
        .where('startTime', '>=', start)
        .where('startTime', '<=', end)
        .limit(exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT)
        .get();
    const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
    const rows = [];
    for (const docSnap of qsnap.docs) {
        const shift = docSnap.data();
        if (shift.status === 'Canceled')
            continue;
        const st = shift.startTime;
        if (!(st instanceof admin.firestore.Timestamp))
            continue;
        const shiftDateObj = st.toDate();
        if (!isSameCordobaCalendarDay(shiftDateObj, fecha))
            continue;
        const oid = String(shift.objectiveId ?? '').trim();
        if (!oid || !objectiveMap.has(oid))
            continue;
        const empId = String(shift.employeeId ?? '').trim();
        if (!empId || empId === 'VACANTE')
            continue;
        const codeRaw = String(shift.code ?? shift.type ?? '').trim();
        const codeU = codeRaw.toUpperCase();
        const isFranco = FRANCO_CODES.has(codeU);
        const isRet = codeU === 'RET';
        const wantF = tipo === 'franco' || tipo === 'ambos';
        const wantR = tipo === 'ret' || tipo === 'ambos';
        if (!(isFranco && wantF) && !(isRet && wantR))
            continue;
        const meta = objectiveMap.get(oid);
        const nombreEmp = String(shift.employeeName ?? '').trim();
        rows.push({
            employee_firestore_id: empId,
            empleado_etiqueta: nombreEmp || empId.slice(0, 12),
            codigo: codeRaw || codeU,
            cliente: meta.clientName,
            objetivo: meta.name,
            objetivo_id: oid,
            hora_inicio_cor: horaHmCordoba(shiftDateObj),
        });
    }
    rows.sort((a, b) => {
        const c0 = `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es');
        if (c0 !== 0)
            return c0;
        return a.empleado_etiqueta.localeCompare(b.empleado_etiqueta, 'es');
    });
    return { rows, truncado: qsnap.size >= exports.ASSISTANT_TURNOS_DIA_QUERY_LIMIT };
}
async function empleadosCoordsBatch(db, empresaId, empIds) {
    const out = new Map();
    const uniq = [...new Set(empIds)].filter(Boolean);
    const refs = uniq.map((id) => db.collection('empleados').doc(id));
    const snaps = await firestoreGetAllRefs(db, refs);
    for (let j = 0; j < snaps.length; j++) {
        const s = snaps[j];
        if (!s.exists)
            continue;
        const row = s.data();
        const empE = String(row.empresaId ?? '').trim();
        if (empE && empE.toLowerCase() !== empresaId.toLowerCase())
            continue;
        const lat = row.lat != null ? Number(row.lat) : NaN;
        const lng = row.lng != null ? Number(row.lng) : NaN;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            out.set(s.id, { lat, lng });
        }
    }
    return out;
}
async function ejecutarListadoFrancoRetDia(ctx, args) {
    if (!canQueryOperationsDaySummary(ctx)) {
        return { error: 'sin_permiso_requiere_modulo_operaciones_planificacion_o_similar' };
    }
    const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
    const tipoRaw = String(args.tipo ?? 'ambos').trim().toLowerCase();
    const tipo = tipoRaw === 'franco' || tipoRaw === 'ret' || tipoRaw === 'ambos' ? tipoRaw : 'ambos';
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    let lim = Math.floor(Number(args.limite ?? 80));
    if (!Number.isFinite(lim))
        lim = 80;
    lim = Math.max(8, Math.min(160, lim));
    const db = admin.firestore();
    const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, undefined);
    if (objectiveMap.size === 0) {
        return { fecha_referencia: fecha, nota: 'sin_objetivos_para_esta_empresa', cuenta: 0, filas: [] };
    }
    const { rows: raw, truncado } = await collectFrancoRetTurnosDia(db, objectiveMap, fecha, tipo);
    const idCerc = String(args.id_objetivo_cercania ?? '').trim();
    if (idCerc) {
        const withCoords = await objectivesMapWithCoordsForEmpresa(db, ctx.empresaId, undefined);
        const target = withCoords.get(idCerc);
        if (!target) {
            return { error: 'objetivo_no_encontrado_en_empresa', hint: 'usar id Firestore del objetivo (CRM).' };
        }
        if (target.lat == null || target.lng == null) {
            return {
                error: 'objetivo_sin_coordenadas_en_crm',
                objetivo: target.name,
                hint: 'Cargá lat/lng del objetivo en Clientes y Objetivos para calcular distancias.',
            };
        }
        const empIds = [...new Set(raw.map((r) => r.employee_firestore_id))];
        const coords = await empleadosCoordsBatch(db, ctx.empresaId, empIds);
        const scored = [];
        const sinCoord = [];
        for (const r of raw) {
            const c = coords.get(r.employee_firestore_id);
            if (!c) {
                if (!sinCoord.includes(r.empleado_etiqueta))
                    sinCoord.push(r.empleado_etiqueta);
                scored.push({ ...r, distancia_km: null });
                continue;
            }
            scored.push({
                ...r,
                distancia_km: haversineKm(c.lat, c.lng, target.lat, target.lng),
            });
        }
        scored.sort((a, b) => {
            if (a.distancia_km == null && b.distancia_km == null)
                return 0;
            if (a.distancia_km == null)
                return 1;
            if (b.distancia_km == null)
                return -1;
            return a.distancia_km - b.distancia_km;
        });
        const filas = scored.slice(0, lim).map((r) => ({
            empleado: r.empleado_etiqueta,
            codigo: r.codigo,
            cliente: r.cliente,
            objetivo_turno: r.objetivo,
            hora_inicio_cor: r.hora_inicio_cor,
            distancia_km_al_objetivo_pedido: r.distancia_km != null ? Math.round(r.distancia_km * 100) / 100 : null,
        }));
        return {
            fecha_referencia: fecha,
            tipo_filtro: tipo,
            objetivo_referencia_distancia: { id: idCerc, nombre: target.name, cliente: target.clientName },
            criterios: 'Turnos del día (zona AR) con código F/FF/FP/FT (franco) o RET, objetivos de la empresa; incluye borradores/planificación. Distancia = Haversine entre lat/lng del legajo (RRHH) y el objetivo pedido.',
            cuenta_filas: raw.length,
            truncado_consulta_turnos: truncado,
            muestra_cap: lim,
            filas,
            empleados_sin_coordenadas_en_legajo_muestra: sinCoord.slice(0, 24),
            nota_tras_herramienta: 'Ordená por distancia_km_al_objetivo_pedido ascendente; los null no tienen geolocalización en el legajo. No inventes nombres: usá solo campos de filas.',
        };
    }
    const filas = raw.slice(0, lim).map((r) => ({
        empleado: r.empleado_etiqueta,
        id_legajo: r.employee_firestore_id,
        codigo: r.codigo,
        cliente: r.cliente,
        objetivo: r.objetivo,
        hora_inicio_cor: r.hora_inicio_cor,
    }));
    return {
        fecha_referencia: fecha,
        tipo_filtro: tipo,
        criterios: 'Turnos del día (zona AR) con código F/FF/FP/FT (franco) o RET en objetivos de la empresa; incluye planificación/borrador. No es la misma vista filtrada que el monitor de cobertura operativa.',
        cuenta_filas: raw.length,
        truncado_consulta_turnos: truncado,
        muestra_cap: lim,
        filas,
        nota_tras_herramienta: 'Para «quién está de franco» o «quién en RET» listá filas. Si pedís cercanía a un objetivo, llamá de nuevo con id_objetivo_cercania. No inventes nombres.',
    };
}
function assistantToolsEnabledForContext(ctx) {
    if (!ctx.empresaId)
        return false;
    if (ctx.persona === 'CLIENT')
        return false;
    return (canQueryShifts(ctx) ||
        canUseEmployeeSearch(ctx) ||
        canQueryServiciosSlaResumen(ctx) ||
        canQueryEmpleadosPlantillaResumen(ctx) ||
        canSearchObjectivesCrm(ctx));
}
function parseYmd(s) {
    const rex = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!rex)
        throw new Error('fecha debe ser YYYY-MM-DD');
    const y = Number(rex[1]);
    const mo = Number(rex[2]);
    const d = Number(rex[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31)
        throw new Error('fecha inválida');
    return { y, m: mo, d };
}
function slaCampoFechaYmD(raw) {
    if (raw == null)
        return '';
    if (typeof raw === 'string')
        return raw.trim().slice(0, 10);
    if (raw instanceof admin.firestore.Timestamp) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Cordoba',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(raw.toDate());
    }
    if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
        const o = raw;
        try {
            const ts = new admin.firestore.Timestamp(o.seconds, o.nanoseconds ?? 0);
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Argentina/Cordoba',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(ts.toDate());
        }
        catch {
            return '';
        }
    }
    return '';
}
async function empresaClientIdsSet(db, empresaId) {
    const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(520).get();
    return new Set(snap.docs.map((d) => d.id));
}
function chunkIds(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
function servicioSlaSolapaMesReferencia(desdeYmd, hastaYmd, refYmd) {
    const ym = refYmd.slice(0, 7);
    const sd = (desdeYmd || '').trim().slice(0, 10);
    const ed = (hastaYmd || '').trim().slice(0, 10);
    if (sd.length < 10 || ed.length < 10)
        return false;
    return sd <= `${ym}-31` && ed >= `${ym}-01`;
}
function servicioSlaVigenteEnDiaInclusivo(desdeYmd, hastaYmd, refYmd) {
    const sd = (desdeYmd || '').trim().slice(0, 10);
    const ed = (hastaYmd || '').trim().slice(0, 10);
    if (sd.length < 10 || ed.length < 10)
        return false;
    return sd <= refYmd && ed >= refYmd;
}
function slaStatusOperativoComoPantallaServicios(row) {
    const s = String(row.status ?? '').trim().toLowerCase();
    if (!s)
        return true;
    if (s === 'active' || s === 'activo' || s === 'activa')
        return true;
    if (s === 'inactive' || s === 'inactivo' || s === 'expired' || s === 'vencido')
        return false;
    return true;
}
function arRangeTimestamps(desdeYsMmDd, hastaYsMmDd) {
    const a = parseYmd(desdeYsMmDd);
    const b = parseYmd(hastaYsMmDd);
    const t0 = Date.parse(`${a.y}-${String(a.m).padStart(2, '0')}-${String(a.d).padStart(2, '0')}T00:00:00.000${AR_DAY_OFFSET}`);
    const t1 = Date.parse(`${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}T23:59:59.999${AR_DAY_OFFSET}`);
    if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0)
        throw new Error('rango de fechas inválido');
    if ((t1 - t0) / 86400000 > 98)
        throw new Error('el rango no puede superar ~98 días');
    return {
        start: admin.firestore.Timestamp.fromMillis(t0),
        end: admin.firestore.Timestamp.fromMillis(t1),
    };
}
async function assertEmployeeInEmpresa(db, employeeDocId, empresaId) {
    const ref = db.collection('empleados').doc(employeeDocId);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data() || {};
    const empE = String(data.empresaId ?? '').trim();
    if (empresaId && empE && empE.toLowerCase() !== empresaId.toLowerCase())
        return null;
    return data;
}
async function resolveSelfEmployeeFirestoreId(uid) {
    const db = admin.firestore();
    const q = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    if (q.empty)
        return null;
    return q.docs[0].id;
}
async function ejecutarBuscarEmpleadosPorNombre(ctx, args) {
    if (!canUseEmployeeSearch(ctx)) {
        return { error: 'sin_permiso_para_buscar_personal' };
    }
    const textoRaw = String(args.texto ?? '').trim();
    if (textoRaw.length < 2)
        return { error: 'pedir_al_usuario_fragmento_de_nombre_mas_largo' };
    let limite = Math.floor(Number(args.limite ?? 8));
    if (!Number.isFinite(limite) || limite < 1)
        limite = 8;
    limite = Math.min(15, limite);
    const db = admin.firestore();
    const snap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(400).get();
    const needle = norm(textoRaw.replace(/,/g, ' ').replace(/\s+/g, ' '));
    const out = [];
    for (const d of snap.docs) {
        const data = d.data();
        const hay = buildEmpleadoSearchHaystack(data);
        if (!hay)
            continue;
        if (!matchesEmpleadoSearchNeedle(needle, hay))
            continue;
        const ln = String(data.lastName ?? '').trim();
        const fn = String(data.firstName ?? '').trim();
        const name = String(data.name ?? data.nombre ?? '').trim();
        const nombreLegible = [ln, fn].filter(Boolean).join(', ') ||
            name ||
            [fn, ln].filter(Boolean).join(' ') ||
            '(sin nombre en legajo)';
        out.push({
            id: d.id,
            nombre: nombreLegible,
            clienteId: data.clientId ?? undefined,
            preferredObjectiveId: data.preferredObjectiveId ?? undefined,
        });
        if (out.length >= limite * 4)
            break;
    }
    const sliced = out.slice(0, limite);
    if (sliced.length === 0) {
        return {
            coincidencias: [],
            nota: 'ningún resultado; probá apellido, nombre, ambos en cualquier orden, o número de legajo (fileNumber)',
        };
    }
    const ambigua = sliced.length >= 2;
    return {
        coincidencias: sliced.map((r) => ({ idFirestore: r.id, nombreLegible: r.nombre })),
        ambigua,
        nota_ambigua: ambigua && sliced.length <= limite
            ? 'varias personas similares: pedí al usuario aclaración o segundo apellido y volvé a buscar antes de declarar estado de presencia.'
            : undefined,
        nota_tras_herramienta: 'La búsqueda usa apellido, nombre, el campo name del legajo (incluye formato «APELLIDO, NOMBRE») y legajo; el orden de las palabras que escribió el usuario no importa si todas las partes aparecen en el legajo.',
    };
}
async function ejecutarListadoEmpleadosEmpresa(ctx, args) {
    if (!canUseEmployeeSearch(ctx)) {
        return { error: 'sin_permiso_para_buscar_personal' };
    }
    let limite = Math.floor(Number(args.limite ?? 48));
    if (!Number.isFinite(limite) || limite < 8)
        limite = 48;
    limite = Math.min(120, limite);
    const filtroRaw = String(args.filtro_texto ?? '').trim();
    const needle = filtroRaw.length >= 2 ? norm(filtroRaw.replace(/,/g, ' ').replace(/\s+/g, ' ')) : '';
    const soloPanel = args.solo_activos_nomina_panel === true;
    const db = admin.firestore();
    const qsnap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(900).get();
    const rows = [];
    for (const d of qsnap.docs) {
        const data = d.data();
        if (soloPanel && !esEmpleadoNominaTarjetaDashboard(data.status))
            continue;
        const ln = String(data.lastName ?? '').trim();
        const fn = String(data.firstName ?? '').trim();
        const nombreLegible = [ln, fn].filter(Boolean).join(', ') ||
            String(data.name ?? data.nombre ?? '').trim() ||
            '(sin nombre en legajo)';
        const hay = buildEmpleadoSearchHaystack(data);
        const effectiveHay = hay || norm(nombreLegible.replace(/,/g, ' ').replace(/\s+/g, ' '));
        if (needle) {
            if (!matchesEmpleadoSearchNeedle(needle, effectiveHay))
                continue;
        }
        const sortKey = norm(`${ln} ${fn} ${nombreLegible}`);
        rows.push({
            id: d.id,
            nombreLegible: nombreLegible.slice(0, 120),
            legajo: String(data.fileNumber ?? '').trim(),
            estado: String(data.status ?? '').trim(),
            sortKey,
        });
    }
    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'es', { sensitivity: 'base' }));
    const sliced = rows.slice(0, limite);
    const truncadoLista = rows.length > limite;
    const truncadoFirestore = qsnap.size >= 900;
    return {
        filtro_texto_usado: filtroRaw || null,
        solo_activos_nomina_panel: soloPanel,
        cuenta_en_resultado: rows.length,
        muestra_empleados: sliced.map((r) => ({
            id_firestore: r.id,
            nombre: r.nombreLegible,
            legajo: r.legajo || undefined,
            estado: r.estado || undefined,
        })),
        truncado_por_limite_muestra: truncadoLista,
        truncado_loteFirestore_900: truncadoFirestore,
        nota_tras_herramienta: 'Listá nombres tal cual vienen en muestra_empleados; no inventes filas. Si truncado_por_limite_muestra o truncado_loteFirestore_900, pedí acotar con filtro_texto (apellido o legajo) o más contexto en Reportes/RRHH. Para una persona puntual seguí usando buscar_empleados_por_nombre.',
    };
}
async function ejecutarBuscarObjetivosPorNombre(ctx, args) {
    if (!canSearchObjectivesCrm(ctx)) {
        return { error: 'sin_permiso_buscar_objetivos_crm' };
    }
    const textoRaw = String(args.texto ?? '').trim();
    if (textoRaw.length < 2)
        return { error: 'pedir_fragmento_de_nombre_mas_largo' };
    let limite = Math.floor(Number(args.limite ?? 12));
    if (!Number.isFinite(limite) || limite < 1)
        limite = 12;
    limite = Math.min(20, limite);
    const db = admin.firestore();
    const snap = await db.collection('clients').where('empresaId', '==', ctx.empresaId).limit(480).get();
    const needle = norm(textoRaw);
    const out = [];
    const pushObj = (clientDocId, clientName, oid, oname, o) => {
        const lat = o?.lat != null ? Number(o.lat) : NaN;
        const lng = o?.lng != null ? Number(o.lng) : NaN;
        const has = Number.isFinite(lat) && Number.isFinite(lng);
        out.push({
            id_objetivo: oid,
            nombre_objetivo: oname.slice(0, 120),
            id_cliente: clientDocId,
            nombre_cliente: clientName.slice(0, 120),
            tiene_coordenadas: has,
        });
    };
    for (const d of snap.docs) {
        const data = d.data();
        const clientName = String(data.name ?? '').trim() || d.id;
        const objetivosRaw = data.objetivos ?? data.objectives;
        const objetivos = Array.isArray(objetivosRaw) ? objetivosRaw : undefined;
        if (Array.isArray(objetivos)) {
            for (const o of objetivos) {
                const oid = String(o?.id ?? '').trim();
                if (!oid)
                    continue;
                const oname = String(o?.name ?? '').trim() || oid;
                const nameNorm = norm(oname);
                const idNorm = norm(oid);
                if (!nameNorm.includes(needle) && !idNorm.includes(needle) && nameNorm !== needle)
                    continue;
                pushObj(d.id, clientName, oid, oname, o);
                if (out.length >= limite * 5)
                    break;
            }
        }
        else if (!objetivos) {
            const oid = d.id;
            const oname = clientName;
            const hay = norm(`${oname} ${oid}`);
            if (!hay.includes(needle))
                continue;
            pushObj(d.id, clientName, oid, oname, data);
        }
        if (out.length >= limite * 5)
            break;
    }
    const sliced = out.slice(0, limite);
    if (sliced.length === 0) {
        return { coincidencias: [], nota: 'ningún objetivo; probá otro fragmento del nombre del sitio o del cliente' };
    }
    const ambigua = sliced.length >= 2;
    return {
        coincidencias: sliced.map((r) => ({
            id_objetivo: r.id_objetivo,
            nombre_objetivo: r.nombre_objetivo,
            id_cliente: r.id_cliente,
            nombre_cliente: r.nombre_cliente,
            tiene_coordenadas: r.tiene_coordenadas,
        })),
        ambigua,
        nota_tras_herramienta: (ambigua
            ? 'Varias sedes: pedí aclaración (cliente o parte del nombre) o que el usuario elija id_objetivo antes de listado_franco_ret_dia con id_objetivo_cercania.'
            : 'Si el usuario sólo dijo el nombre del sitio, usá id_objetivo de la coincidencia en listado_franco_ret_dia(id_objetivo_cercania=…).') +
            ' No inventes ids.',
    };
}
async function ejecutarConsultarTurnosEmpleado(ctx, args) {
    if (!canQueryShifts(ctx)) {
        return { error: 'sin_permiso_para_consultar_turnos' };
    }
    let empId = String(args.id_firestore_empleado ?? '').trim();
    if (ctx.persona === 'EMPLOYEE') {
        if (!ctx.selfEmployeeFirestoreId) {
            return { error: 'portal_empleado_sin_legajo_vinculado' };
        }
        if (empId && empId !== ctx.selfEmployeeFirestoreId) {
            return { error: 'portal_empleado_solo_turnos_propios' };
        }
        empId = ctx.selfEmployeeFirestoreId;
    }
    else if (!empId) {
        return { error: 'falta_id_firestore_empleado_primero_usar_buscar_empleados' };
    }
    const db = admin.firestore();
    const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId);
    if (!empRow)
        return { error: 'empleado_inexistente_o_fuera_de_empresa' };
    let desde = String(args.fecha_desde ?? '').trim();
    let hasta = String(args.fecha_hasta ?? '').trim();
    if (!desde || !hasta) {
        desde = hasta = ctx.referenceDateYsMmDd;
    }
    let start;
    let end;
    try {
        ({ start, end } = arRangeTimestamps(desde, hasta));
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    const qsnap = await db
        .collection('turnos')
        .where('employeeId', '==', empId)
        .where('startTime', '>=', start)
        .where('startTime', '<=', end)
        .limit(32)
        .get();
    const turnos = qsnap.docs.map((docSnap) => {
        const t = docSnap.data();
        const ts = (x) => (x instanceof admin.firestore.Timestamp ? x.toDate().toISOString() : null);
        const code = String(t.code ?? t.type ?? '').trim();
        const present = !!(t.isPresent === true || t.checkInTime);
        const absent = !!(t.isAbsent === true);
        const done = !!(t.isCompleted === true);
        const draft = !!(t.draft === true);
        let presenciaHumana = absent ? 'ausente_según_turno'
            : present ? 'presente_marcó_o_checkin'
                : done ? 'turno_finalizado_sin_señal_de_checkin_explícito'
                    : draft ? 'borrador_planeado_sin_operar_confirmado'
                        : 'planeado_sin_marcacion_aun';
        if (present && absent)
            presenciaHumana = 'marcado_conflictivo_revisar_módulo_operaciones';
        return {
            idTurno: docSnap.id,
            inicioUtc: ts(t.startTime),
            finUtc: ts(t.endTime),
            codigo: code || undefined,
            objetivo: String(t.objectiveName ?? t.objectiveId ?? '') || undefined,
            puesto: String(t.positionName ?? '') || undefined,
            borrador: draft,
            publicado_inferido: draft ? 'posible_plan_borrador' : 'probable_turno_efectivo',
            campo_isPresent: t.isPresent ?? null,
            campo_isAbsent: t.isAbsent ?? null,
            campo_isCompleted: t.isCompleted ?? null,
            origen_OPERACION_planificado: String(t.origin ?? '') || undefined,
            resumen_presencia_para_usuario: presenciaHumana,
        };
    });
    turnos.sort((a, b) => String(a.inicioUtc ?? '').localeCompare(String(b.inicioUtc ?? '')));
    return {
        empleado: { idFirestore: empId, nombreLegible: String(empRow.name ?? empRow.nombre ?? '') || '(sin nombre en legajo)' },
        rango: { desde_inclusive: desde, hasta_inclusive: hasta },
        turnos,
        cuenta: turnos.length,
        aclaracion: turnos.some((z) => z.borrador) && turnos.some((z) => !z.borrador)
            ? 'mezcla_borrador_y_no_borrador: aclarás qué registros pueden ser sólo planeación.'
            : undefined,
    };
}
const ASSISTANT_HOURS_NON_COVERAGE_CODES = new Set([
    'F',
    'FF',
    'FP',
    'FT',
    'V',
    'L',
    'A',
    'E',
    'AA',
    'PG',
    'RET',
]);
const ASSISTANT_SHIFT_HOURS_LOOKUP = {
    M: 8,
    T: 8,
    N: 8,
    D12: 12,
    N12: 12,
    PU: 12,
    GU: 8,
    EN: 9,
    C: 8,
    F: 0,
    FF: 0,
    FP: 0,
    FT: 0,
    V: 0,
    L: 0,
    A: 0,
    E: 0,
    AA: 0,
    PG: 0,
    RET: 0,
};
async function firestoreGetAllRefs(db, refs) {
    const out = [];
    const BATCH = 10;
    for (let i = 0; i < refs.length; i += BATCH) {
        const slice = refs.slice(i, i + BATCH);
        if (slice.length === 0)
            continue;
        const snaps = await db.getAll(...slice);
        out.push(...snaps);
    }
    return out;
}
function readFirestoreTs(row, key) {
    const v = row[key];
    if (v instanceof admin.firestore.Timestamp)
        return v;
    if (v && typeof v === 'object' && v !== null && 'seconds' in v) {
        const o = v;
        const s = Number(o.seconds);
        const n = Number(o.nanoseconds ?? 0);
        if (Number.isFinite(s))
            return new admin.firestore.Timestamp(Math.floor(s), Number.isFinite(n) ? Math.floor(n) : 0);
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
        const core = v.trim().slice(0, 10);
        const t0 = Date.parse(`${core}T12:00:00.000${AR_DAY_OFFSET}`);
        if (Number.isFinite(t0))
            return admin.firestore.Timestamp.fromMillis(t0);
    }
    return null;
}
async function queryTurnosEmpleadoEnRango(db, empId, start, end, lim) {
    try {
        const qsnap = await db
            .collection('turnos')
            .where('employeeId', '==', empId)
            .where('startTime', '>=', start)
            .where('startTime', '<=', end)
            .limit(lim)
            .get();
        return { docs: qsnap.docs, uso_fallback: false };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[assistant] queryTurnosEmpleadoEnRango fallback', { empId, msg: msg.slice(0, 200) });
        const qsnap = await db.collection('turnos').where('employeeId', '==', empId).limit(Math.min(900, lim * 3)).get();
        const t0 = start.toMillis();
        const t1 = end.toMillis();
        const docs = qsnap.docs.filter((d) => {
            const st = readFirestoreTs(d.data(), 'startTime');
            if (!st)
                return false;
            const ms = st.toMillis();
            return ms >= t0 && ms <= t1;
        });
        return { docs: docs.slice(0, lim), uso_fallback: true };
    }
}
function plannedCoverageHoursFromShiftRow(row) {
    const rawCode = String(row.code ?? '').trim().toUpperCase();
    if (ASSISTANT_HOURS_NON_COVERAGE_CODES.has(rawCode))
        return 0;
    const st = String(row.status ?? '').toLowerCase();
    if (st.includes('cancel') || st.includes('delet'))
        return 0;
    if (String(row.type ?? '').toUpperCase() === 'NOVEDAD')
        return 0;
    const stored = Number(row.hours);
    if (Number.isFinite(stored) && stored > 0)
        return Math.min(stored, 24);
    const s = readFirestoreTs(row, 'startTime');
    const e = readFirestoreTs(row, 'endTime');
    if (s && e) {
        const h = (e.toMillis() - s.toMillis()) / 3600000;
        if (h > 0 && h <= 24)
            return h;
        if (h > 24)
            return 24;
    }
    const lk = ASSISTANT_SHIFT_HOURS_LOOKUP[rawCode];
    if (typeof lk === 'number')
        return lk;
    return 8;
}
function realWorkedHoursFromShiftRow(row) {
    if (row.isCompleted !== true)
        return null;
    const rs = readFirestoreTs(row, 'realStartTime') ?? readFirestoreTs(row, 'checkInTime');
    const re = readFirestoreTs(row, 'realEndTime') ?? readFirestoreTs(row, 'checkOutTime');
    if (!rs || !re)
        return null;
    const h = (re.toMillis() - rs.toMillis()) / 3600000;
    if (!Number.isFinite(h) || h <= 0 || h > 24)
        return null;
    return Math.round(h * 10) / 10;
}
async function ejecutarResumenHorasEmpleadoPeriodo(ctx, args) {
    if (!canQueryShifts(ctx)) {
        return { error: 'sin_permiso_para_consultar_turnos' };
    }
    let empId = String(args.id_firestore_empleado ?? '').trim();
    if (ctx.persona === 'EMPLOYEE') {
        if (!ctx.selfEmployeeFirestoreId) {
            return { error: 'portal_empleado_sin_legajo_vinculado' };
        }
        if (empId && empId !== ctx.selfEmployeeFirestoreId) {
            return { error: 'portal_empleado_solo_turnos_propios' };
        }
        empId = ctx.selfEmployeeFirestoreId;
    }
    else if (!empId) {
        return { error: 'falta_id_firestore_empleado_primero_usar_buscar_empleados' };
    }
    const db = admin.firestore();
    const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId);
    if (!empRow)
        return { error: 'empleado_inexistente_o_fuera_de_empresa' };
    const desde = String(args.fecha_desde ?? '').trim();
    const hasta = String(args.fecha_hasta ?? '').trim();
    let start;
    let end;
    try {
        ({ start, end } = arRangeTimestamps(desde, hasta));
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    const LIM = 400;
    let turnoDocs;
    let usoFallback = false;
    try {
        const q = await queryTurnosEmpleadoEnRango(db, empId, start, end, LIM);
        turnoDocs = q.docs;
        usoFallback = q.uso_fallback;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[assistant] resumen_horas query turnos', { empId, desde, hasta, msg });
        return { error: 'error_consulta_turnos_firestore', detalle: msg.slice(0, 280) };
    }
    let horasPlanCobertura = 0;
    let horasReales = 0;
    let turnosConReal = 0;
    let omitidos = 0;
    const porCodigo = new Map();
    const muestra = [];
    for (const docSnap of turnoDocs) {
        const row = docSnap.data();
        const st = String(row.status ?? '').toLowerCase();
        if (st.includes('cancel') || st.includes('delet')) {
            omitidos += 1;
            continue;
        }
        if (String(row.type ?? '').toUpperCase() === 'NOVEDAD') {
            omitidos += 1;
            continue;
        }
        const hp = plannedCoverageHoursFromShiftRow(row);
        horasPlanCobertura += hp;
        const code = String(row.code ?? '').trim().toUpperCase() || '(sin código)';
        const pc = porCodigo.get(code) ?? { n: 0, hs: 0 };
        pc.n += 1;
        pc.hs += hp;
        porCodigo.set(code, pc);
        const hr = realWorkedHoursFromShiftRow(row);
        if (hr != null) {
            horasReales += hr;
            turnosConReal += 1;
        }
        if (muestra.length < 14) {
            const s = readFirestoreTs(row, 'startTime');
            muestra.push({
                id_turno_corto: docSnap.id.slice(0, 12),
                dia_inicio_cordoba: s ? formatYmdCordobaFromTs(s) : undefined,
                codigo: code,
                horas_plan_cobertura: Math.round(hp * 10) / 10,
                horas_reales_fichada: hr,
                borrador: !!(row.draft === true),
                completado: !!(row.isCompleted === true),
            });
        }
    }
    const porCodigoArr = Array.from(porCodigo.entries())
        .map(([codigo, v]) => ({ codigo, turnos: v.n, horas_plan_cobertura: Math.round(v.hs * 10) / 10 }))
        .sort((a, b) => b.horas_plan_cobertura - a.horas_plan_cobertura)
        .slice(0, 16);
    const er = empRow;
    const ln = String(er.lastName ?? '').trim();
    const fn = String(er.firstName ?? '').trim();
    const nombreLegible = [ln, fn].filter(Boolean).join(', ') ||
        String(er.name ?? er.nombre ?? '').trim() ||
        [fn, ln].filter(Boolean).join(' ') ||
        '(sin nombre en legajo)';
    return {
        empleado: {
            idFirestore: empId,
            nombreLegible,
        },
        rango: { desde_inclusive: desde, hasta_inclusive: hasta },
        totales: {
            horas_planificadas_cobertura: Math.round(horasPlanCobertura * 10) / 10,
            horas_reales_fichadas_sumadas: Math.round(horasReales * 10) / 10,
            turnos_considerados: turnoDocs.length - omitidos,
            turnos_omitidos_cancelados_o_novedad: omitidos,
            turnos_con_horas_reales: turnosConReal,
        },
        por_codigo: porCodigoArr,
        truncado_consulta_turnos_limite: turnoDocs.length >= LIM,
        consulta_turnos_uso_fallback_sin_indice_compuesto: usoFallback,
        muestra_turnos: muestra,
        criterios: {
            horas_planificadas_cobertura: 'Suma duración teórica de turnos con código de cobertura (excluye F/FF/FP/FT/V/L/A/E/AA/PG/RET y NOVEDAD/cancelados). Usa campo hours, o startTime–endTime, o tabla CCT básica M/T/N/D12/N12/PU/GU/EN/C.',
            horas_reales_fichadas_sumadas: 'Suma (realStartTime–realEndTime) o (checkInTime–checkOutTime) solo si isCompleted=true y ambos extremos existen; no sustituye liquidación con reglas de noche/feriado.',
        },
        nota_tras_herramienta: 'Respondé con totales.horas_planificadas_cobertura para «horas planificadas de puesto» en el período; totales.horas_reales_fichadas_sumadas solo si preguntan fichadas/reales y aclarar que es parcial si hay pocos turnos con real. Si truncado_consulta_turnos_limite=true, decí que puede faltar cola del período. Para liquidación oficial o nocturnas/feriados remití al módulo Reportes y liquidación.',
    };
}
function formatYmdCordobaFromTs(ts) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Cordoba',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(ts.toDate());
    }
    catch {
        return '';
    }
}
async function ejecutarResumenPresenciasObjetivosDia(ctx, args) {
    if (!canQueryOperationsDaySummary(ctx)) {
        return { error: 'sin_permiso_resumen_operaciones_requiere_modulo_operaciones_planificacion_o_similar' };
    }
    const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
    const filterObj = String(args.id_objetivo ?? '').trim() || undefined;
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    const db = admin.firestore();
    const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj);
    if (objectiveMap.size === 0) {
        return {
            fecha_referencia: fecha,
            nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
            totales: { turnos_visibles_en_dia: 0, presentes: 0, ausentes: 0, sin_marcacion_relevante: 0 },
            por_objetivo: [],
        };
    }
    let visibleRows;
    let truncadoConsultaTurnos;
    try {
        ({ rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(db, objectiveMap, fecha));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: 'error_consulta_turnos_operaciones', detalle: msg.slice(0, 280) };
    }
    const byObj = new Map();
    const ensureRow = (oid) => {
        let r = byObj.get(oid);
        if (!r) {
            const meta = objectiveMap.get(oid);
            r = {
                objetivo_id: oid,
                objetivo_nombre: meta?.name ?? oid,
                cliente: meta?.clientName ?? '',
                presentes: 0,
                ausentes: 0,
                sin_marcacion: 0,
                turnos_visibles: 0,
            };
            byObj.set(oid, r);
        }
        return r;
    };
    let presentes = 0;
    let ausentes = 0;
    let sinMarc = 0;
    let visibles = 0;
    for (const c of visibleRows) {
        const row = ensureRow(c.oid);
        row.turnos_visibles += 1;
        visibles += 1;
        if (c.isPresent) {
            row.presentes += 1;
            presentes += 1;
        }
        else if (c.isAbsent) {
            row.ausentes += 1;
            ausentes += 1;
        }
        else {
            row.sin_marcacion += 1;
            sinMarc += 1;
        }
    }
    const porObjetivo = Array.from(byObj.values())
        .filter((r) => r.turnos_visibles > 0)
        .sort((a, b) => (a.cliente + a.objetivo_nombre).localeCompare(b.cliente + b.objetivo_nombre, 'es'));
    return {
        fecha_referencia: fecha,
        zona: 'America/Argentina/Cordoba',
        criterio_presente: 'isPresent true, empleado asignado distinto de VACANTE, isAbsent false (como pantalla Operaciones)',
        truncado_limite_turnos_consultados: truncadoConsultaTurnos,
        totales: {
            turnos_visibles_en_dia: visibles,
            presentes,
            ausentes,
            sin_marcacion_relevante: sinMarc,
        },
        por_objetivo: porObjetivo.slice(0, 64),
        nota_tras_herramienta: 'Respondé con los totales y, si preguntan por objetivos, mencioná los que más concentran guardias según por_objetivo.',
    };
}
async function ejecutarListadoTurnosOperativosDia(ctx, args) {
    if (!canQueryOperationsDaySummary(ctx)) {
        return { error: 'sin_permiso_resumen_operaciones_requiere_modulo_operaciones_planificacion_o_similar' };
    }
    const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
    const filterObj = String(args.id_objetivo ?? '').trim() || undefined;
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    let lim = Math.floor(Number(args.limite ?? 96));
    if (!Number.isFinite(lim))
        lim = 96;
    lim = Math.max(8, Math.min(120, lim));
    const db = admin.firestore();
    let objectiveMap;
    try {
        objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: 'error_consulta_objetivos', detalle: msg.slice(0, 280) };
    }
    if (objectiveMap.size === 0) {
        return {
            fecha_referencia: fecha,
            nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
            cuenta_total_turnos_visibles: 0,
            muestra_turnos: [],
        };
    }
    let visibleRows;
    let truncadoConsultaTurnos;
    try {
        ({ rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(db, objectiveMap, fecha));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[assistant] ejecutarListadoTurnosOperativosDia', { fecha, msg });
        return { error: 'error_consulta_turnos_operaciones', detalle: msg.slice(0, 280) };
    }
    const muestra = visibleRows.slice(0, lim).map((r) => ({
        cliente: r.cliente,
        objetivo: r.objetivo_nombre,
        hora_inicio_cor: r.h_inicio_cordoba,
        codigo: r.codigo,
        puesto: r.puesto,
        persona: r.empleado_etiqueta,
        estado_presencia: r.isPresent ? 'presente'
            : r.isAbsent ? 'ausente'
                : 'asignado_sin_marcacion_todavia',
    }));
    return {
        fecha_referencia: fecha,
        criterios: 'Misma vista que Operaciones para el día referencia en zona Cordoba.',
        cuenta_total_turnos_visibles: visibleRows.length,
        muestra_cap: lim,
        truncado_limite_turnos_consultados: truncadoConsultaTurnos,
        muestra_truncada_vs_total: visibleRows.length > muestra.length,
        muestra_turnos: muestra,
        nota_tras_herramienta: 'Contestá agrupando por cliente/objetivo; si muestra_truncada_vs_total=true o truncado_limite_turnos_consultados=true, aclaralo al usuario.',
    };
}
async function ejecutarContarServiciosSlaVigentesEmpresa(ctx, args) {
    if (!canQueryServiciosSlaResumen(ctx)) {
        return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
    }
    const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    const db = admin.firestore();
    const clientIds = await empresaClientIdsSet(db, ctx.empresaId);
    if (clientIds.size === 0) {
        return {
            fecha_referencia: fecha,
            mes_yyyy_mm: fecha.slice(0, 7),
            cuenta_para_tarjeta_servicios_activos_del_mes: 0,
            cuenta_objetivos_distintos_con_sla_en_ese_mes: 0,
            cuenta_contratos_vigentes_en_el_dia_referencia: 0,
            nota: 'ningún_cliente_de_esta_empresa_en_clients',
            muestra_contratos_en_mes: [],
        };
    }
    const idList = Array.from(clientIds);
    const byDocId = new Map();
    for (const batch of chunkIds(idList, 10)) {
        const qs = await db.collection('servicios_sla').where('clientId', 'in', batch).limit(500).get();
        for (const d of qs.docs) {
            if (!byDocId.has(d.id))
                byDocId.set(d.id, d);
        }
    }
    let incompletosPeriodo = 0;
    let cuentaSolapaMes = 0;
    let cuentaVigentesDia = 0;
    const objetivosUnicosMes = new Set();
    const vigentesParaMuestra = [];
    const incompletosMuestra = [];
    for (const docSnap of byDocId.values()) {
        const row = docSnap.data();
        const cid = String(row.clientId ?? '').trim();
        if (!cid || !clientIds.has(cid))
            continue;
        const desde = slaCampoFechaYmD(row.startDate ?? row.desde ?? row.inicioContrato ?? '');
        const hasta = slaCampoFechaYmD(row.endDate ?? row.hasta ?? row.finContrato ?? '');
        if (!desde || !hasta) {
            incompletosPeriodo += 1;
            if (incompletosMuestra.length < 6) {
                incompletosMuestra.push({
                    cliente: String(row.clientName ?? '').slice(0, 80),
                    objetivo: String(row.objectiveName ?? '').slice(0, 80),
                    id_doc_corto: docSnap.id.slice(0, 12),
                    motivo: 'falta_o_invalido_start_or_end_Date',
                });
            }
            continue;
        }
        const solapaMes = servicioSlaSolapaMesReferencia(desde, hasta, fecha);
        if (solapaMes) {
            cuentaSolapaMes += 1;
            const oid = String(row.objectiveId ?? '').trim() || String(row.objectiveName ?? '').trim() || docSnap.id;
            objetivosUnicosMes.add(`${cid}__${oid}`);
            const item = {
                cliente: String(row.clientName ?? cid).slice(0, 100),
                objetivo: String(row.objectiveName ?? row.objectiveId ?? '').slice(0, 100),
                desde,
                hasta,
                estado: String(row.status ?? '').slice(0, 24),
                id_servicio_firestore_corto: docSnap.id.slice(0, 14),
            };
            if (vigentesParaMuestra.length < 80)
                vigentesParaMuestra.push(item);
        }
        if (slaStatusOperativoComoPantallaServicios(row) && servicioSlaVigenteEnDiaInclusivo(desde, hasta, fecha)) {
            cuentaVigentesDia += 1;
        }
    }
    const muestraLista = [...vigentesParaMuestra]
        .sort((a, b) => `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es'))
        .slice(0, 36);
    return {
        fecha_referencia: fecha,
        mes_yyyy_mm: fecha.slice(0, 7),
        criterios: {
            tarjeta_panel_y_kpi_servicios: 'Cuenta documentos en servicios_sla cuyo clientId pertenece a clients.empresaId actual y startDate/endDate solapan el mes calendario de fecha_referencia (misma regla string que dashboard y KPI «Servicios activos» del mes en la pantalla Servicios).',
            vigentes_en_un_dia: 'cuenta_contratos_vigentes_en_el_dia_referencia = status operativo (activo/activo en español o vacío; excluye inactivo) y el día fecha_referencia está entre start y end inclusive.',
        },
        cuenta_para_tarjeta_servicios_activos_del_mes: cuentaSolapaMes,
        cuenta_objetivos_distintos_con_sla_en_ese_mes: objetivosUnicosMes.size,
        cuenta_contratos_vigentes_en_el_dia_referencia: cuentaVigentesDia,
        cuenta_activos_sin_rango_fechas_calendario: incompletosPeriodo,
        muestra_contratos_en_mes: muestraLista,
        muestra_activos_sin_fechas: incompletosMuestra,
        nota_tras_herramienta: 'Respondé con cuenta_para_tarjeta_servicios_activos_del_mes cuando la pregunta sea «cuántos servicios activos» como en el panel o la tarjeta del mes (coincide con el KPI del módulo Servicios). Usá cuenta_objetivos_distintos_con_sla_en_ese_mes si hablan de «objetivos» o tarjetas por sitio. Usá cuenta_contratos_vigentes_en_el_dia_referencia solo si piden explícitamente vigentes «hoy» / en esa fecha con sentido contractual estricto. No inventes cifras. Si listan nombres de contratos o SLA, usá solo los textos del array muestra_contratos_en_mes (campos cliente y objetivo); si la muestra no alcanza, decí que hay más y que vean Servicios y SLA; no inventes títulos comerciales.',
    };
}
async function loadServiciosSlaDocsEmpresa(db, empresaId) {
    const clientIds = await empresaClientIdsSet(db, empresaId);
    if (clientIds.size === 0)
        return [];
    const idList = Array.from(clientIds);
    const byDocId = new Map();
    for (const batch of chunkIds(idList, 10)) {
        const qs = await db.collection('servicios_sla').where('clientId', 'in', batch).limit(500).get();
        for (const d of qs.docs) {
            if (!byDocId.has(d.id))
                byDocId.set(d.id, d);
        }
    }
    return Array.from(byDocId.values()).map((d) => ({ id: d.id, row: d.data() }));
}
async function ejecutarResumenHorasObjetivoSlaPeriodo(ctx, args) {
    if (!canQueryServiciosSlaResumen(ctx)) {
        return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
    }
    if (!canQueryShifts(ctx)) {
        return { error: 'sin_permiso_consultar_turnos' };
    }
    const fecha = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    let objectiveId = String(args.id_objetivo ?? '').trim();
    const textoObj = String(args.texto_objetivo ?? '').trim();
    const slaIdFilter = String(args.id_servicio_sla ?? '').trim();
    if (!objectiveId && textoObj.length >= 2) {
        const found = await ejecutarBuscarObjetivosPorNombre(ctx, { texto: textoObj, limite: 6 });
        if (String(found.error ?? '').trim())
            return found;
        const coincidencias = (found.coincidencias ?? []);
        if (coincidencias.length === 0) {
            return { error: 'objetivo_no_encontrado', texto_buscado: textoObj };
        }
        if (found.ambigua === true && coincidencias.length >= 2) {
            return {
                error: 'objetivo_ambiguo',
                coincidencias: coincidencias.slice(0, 6).map((c) => ({
                    id_objetivo: c.id_objetivo,
                    nombre: c.nombre_objetivo,
                })),
            };
        }
        objectiveId = String(coincidencias[0].id_objetivo ?? '').trim();
    }
    const db = admin.firestore();
    const allSla = await loadServiciosSlaDocsEmpresa(db, ctx.empresaId);
    const matches = [];
    const needleNorm = textoObj.length >= 2 ? norm(textoObj.replace(/,/g, ' ')) : '';
    let metaNameNorm = '';
    if (objectiveId) {
        const objMeta = await objectivesMapForEmpresa(db, ctx.empresaId, objectiveId);
        metaNameNorm = norm(String(objMeta.get(objectiveId)?.name ?? ''));
    }
    const slaMatchesObjective = (row) => {
        const oid = String(row.objectiveId ?? '').trim();
        if (objectiveId && oid && oid === objectiveId)
            return true;
        if (!needleNorm && !metaNameNorm)
            return false;
        const oname = norm(String(row.objectiveName ?? '').replace(/,/g, ' '));
        const cliente = norm(String(row.clientName ?? row.cliente ?? '').replace(/,/g, ' '));
        const combo = `${cliente} ${oname}`.trim();
        if (metaNameNorm && oname && (oname.includes(metaNameNorm) || metaNameNorm.includes(oname)))
            return true;
        if (needleNorm) {
            if (oname && (oname.includes(needleNorm) || needleNorm.includes(oname)))
                return true;
            if (combo && (combo.includes(needleNorm) || needleNorm.includes(combo)))
                return true;
        }
        return false;
    };
    for (const { id, row } of allSla) {
        if (slaIdFilter && !id.startsWith(slaIdFilter) && id !== slaIdFilter)
            continue;
        if (!slaMatchesObjective(row))
            continue;
        const desde = slaCampoFechaYmD(row.startDate ?? row.desde ?? row.inicioContrato ?? '');
        const hasta = slaCampoFechaYmD(row.endDate ?? row.hasta ?? row.finContrato ?? '');
        if (!desde || !hasta)
            continue;
        if (!servicioSlaSolapaMesReferencia(desde, hasta, fecha))
            continue;
        const positions = Array.isArray(row.positions) ? row.positions : [];
        const vendidas = (0, assistantSlaHours_1.slaHorasVendidasMesCalendario)(positions, desde, hasta, fecha);
        if (!objectiveId) {
            const oid = String(row.objectiveId ?? '').trim();
            if (oid)
                objectiveId = oid;
        }
        matches.push({ id, row, vendidas });
    }
    if (!objectiveId && matches.length === 0 && !textoObj) {
        return { error: 'falta_id_objetivo_o_texto_objetivo' };
    }
    if (matches.length === 0) {
        return {
            error: 'sin_sla_activo_para_objetivo_en_ese_mes',
            id_objetivo: objectiveId || undefined,
            texto_buscado: textoObj || undefined,
            mes_yyyy_mm: fecha.slice(0, 7),
        };
    }
    if (!objectiveId) {
        objectiveId = String(matches[0].row.objectiveId ?? '').trim();
    }
    if (!objectiveId) {
        return {
            error: 'sla_sin_id_objetivo_en_firestore',
            nota: 'El contrato existe pero no tiene objectiveId; revisá Servicios y SLA.',
            mes_yyyy_mm: fecha.slice(0, 7),
        };
    }
    const pick = matches.length === 1
        ? matches[0]
        : matches.find((m) => slaStatusOperativoComoPantallaServicios(m.row)) ?? matches[0];
    const mesStart = `${fecha.slice(0, 7)}-01`;
    const refParts = parseYmd(fecha);
    const lastD = new Date(refParts.y, refParts.m, 0).getDate();
    const mesEnd = `${fecha.slice(0, 7)}-${String(lastD).padStart(2, '0')}`;
    let horasPlanificadas = 0;
    let turnosConsiderados = 0;
    let truncadoTurnos = false;
    const LIM = 500;
    try {
        const { start, end } = arRangeTimestamps(mesStart, mesEnd);
        let turnoDocs;
        try {
            const qsnap = await db
                .collection('turnos')
                .where('objectiveId', '==', objectiveId)
                .where('startTime', '>=', start)
                .where('startTime', '<=', end)
                .limit(LIM)
                .get();
            turnoDocs = qsnap.docs;
            truncadoTurnos = qsnap.size >= LIM;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[assistant] resumen_horas_objetivo fallback turnos', { objectiveId, msg: msg.slice(0, 200) });
            const qsnap = await db.collection('turnos').where('objectiveId', '==', objectiveId).limit(Math.min(900, LIM * 3)).get();
            const t0 = start.toMillis();
            const t1 = end.toMillis();
            turnoDocs = qsnap.docs.filter((d) => {
                const st = readFirestoreTs(d.data(), 'startTime');
                if (!st)
                    return false;
                const ms = st.toMillis();
                return ms >= t0 && ms <= t1;
            });
            truncadoTurnos = turnoDocs.length >= LIM;
            turnoDocs = turnoDocs.slice(0, LIM);
        }
        for (const docSnap of turnoDocs) {
            const row = docSnap.data();
            const hp = plannedCoverageHoursFromShiftRow(row);
            if (hp <= 0)
                continue;
            horasPlanificadas += hp;
            turnosConsiderados += 1;
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: 'error_consulta_turnos_firestore', detalle: msg.slice(0, 280) };
    }
    horasPlanificadas = Math.round(horasPlanificadas * 10) / 10;
    const vendidas = pick.vendidas.horas_vendidas_mes;
    const pendiente = Math.round(Math.max(0, vendidas - horasPlanificadas) * 10) / 10;
    const exceso = Math.round(Math.max(0, horasPlanificadas - vendidas) * 10) / 10;
    const objMeta = await objectivesMapForEmpresa(db, ctx.empresaId, objectiveId);
    const meta = objMeta.get(objectiveId);
    return {
        objetivo: {
            id_objetivo: objectiveId,
            nombre: meta?.name ?? String(pick.row.objectiveName ?? objectiveId),
            cliente: meta?.clientName ?? String(pick.row.clientName ?? ''),
        },
        mes_yyyy_mm: pick.vendidas.mes_yyyy_mm,
        fecha_referencia: fecha,
        contrato_sla: {
            id_firestore_corto: pick.id.slice(0, 14),
            vigencia_desde: slaCampoFechaYmD(pick.row.startDate ?? pick.row.desde ?? ''),
            vigencia_hasta: slaCampoFechaYmD(pick.row.endDate ?? pick.row.hasta ?? ''),
            puestos_en_contrato: Array.isArray(pick.row.positions) ? pick.row.positions.length : 0,
            otros_contratos_mismo_objetivo_mes: matches.length > 1 ? matches.length - 1 : 0,
        },
        totales: {
            horas_vendidas_sla_mes: vendidas,
            horas_nocturnas_vendidas_sla_mes: pick.vendidas.horas_nocturnas_mes,
            dias_contrato_en_mes: pick.vendidas.dias_contrato_en_mes,
            horas_ya_planificadas_turnos_mes: horasPlanificadas,
            turnos_cobertura_considerados: turnosConsiderados,
            horas_pendientes_a_planificar: pendiente,
            horas_planificadas_sobre_vendidas: exceso,
        },
        truncado_consulta_turnos_limite: truncadoTurnos,
        criterios: {
            horas_vendidas_sla_mes: 'Suma diaria de puestos del contrato servicios_sla (coverageType / allowedShiftTypes), mismo motor que la pantalla Servicios y SLA, solo días del mes que caen dentro del rango startDate–endDate del contrato.',
            horas_ya_planificadas_turnos_mes: 'Suma horas de cobertura en turnos del objetivo en el mes calendario (excluye F/FF/RET/licencias; incluye borradores publicados en Firestore).',
            horas_pendientes_a_planificar: 'max(0, vendidas − planificadas); referencia operativa para «cuántas horas faltan cargar» vs el SLA.',
        },
        nota_tras_herramienta: 'Respondé con totales.horas_vendidas_sla_mes (vendidas del contrato) y totales.horas_pendientes_a_planificar si preguntan «horas a planificar». Mencioná horas_ya_planificadas_turnos_mes para lo ya cargado en la grilla. Si horas_planificadas_sobre_vendidas>0, hay más horas planificadas que vendidas (revisar en Planificación). Si truncado_consulta_turnos_limite=true, el total planificado puede estar incompleto.',
    };
}
function compactSlaHorasItemFromResumen(textoBusqueda, r) {
    const err = String(r.error ?? '').trim();
    if (err) {
        return {
            texto_busqueda: textoBusqueda,
            error: err,
            detalle: String(r.detalle ?? '').slice(0, 200),
            coincidencias: r.coincidencias,
        };
    }
    const obj = (r.objetivo ?? {});
    const tot = (r.totales ?? {});
    const contrato = (r.contrato_sla ?? {});
    return {
        texto_busqueda: textoBusqueda,
        cliente: String(obj.cliente ?? ''),
        objetivo: String(obj.nombre ?? textoBusqueda),
        horas_vendidas_sla_mes: tot.horas_vendidas_sla_mes,
        horas_ya_planificadas_turnos_mes: tot.horas_ya_planificadas_turnos_mes,
        horas_pendientes_a_planificar: tot.horas_pendientes_a_planificar,
        horas_planificadas_sobre_vendidas: tot.horas_planificadas_sobre_vendidas,
        puestos_en_contrato: contrato.puestos_en_contrato,
        vigencia_desde: contrato.vigencia_desde,
        vigencia_hasta: contrato.vigencia_hasta,
        truncado_consulta_turnos_limite: r.truncado_consulta_turnos_limite === true,
    };
}
async function ejecutarResumenHorasSlaVariosObjetivos(ctx, args) {
    if (!canQueryServiciosSlaResumen(ctx)) {
        return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
    }
    if (!canQueryShifts(ctx)) {
        return { error: 'sin_permiso_consultar_turnos' };
    }
    const fecha = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
    try {
        parseYmd(fecha);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : 'fecha_invalida' };
    }
    const limite = Math.min(20, Math.max(1, Number(args.limite) || 12));
    let textos = (args.textos_objetivo ?? [])
        .map((s) => String(s).trim())
        .filter((s) => s.length >= 2);
    if (args.todos_servicios_activos_mes === true || textos.length === 0) {
        const cnt = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, { fecha });
        if (String(cnt.error ?? '').trim())
            return cnt;
        const muestra = (cnt.muestra_contratos_en_mes ?? []);
        const fromMuestra = muestra
            .map((m) => {
            const obj = String(m.objetivo ?? '').trim();
            if (obj.length >= 2)
                return obj;
            const cli = String(m.cliente ?? '').trim();
            return cli.length >= 2 ? cli : '';
        })
            .filter((s) => s.length >= 2);
        if (fromMuestra.length > 0)
            textos = fromMuestra;
    }
    const uniq = [];
    const seen = new Set();
    for (const tx of textos) {
        const k = norm(tx);
        if (seen.has(k))
            continue;
        seen.add(k);
        uniq.push(tx);
        if (uniq.length >= limite)
            break;
    }
    if (uniq.length === 0) {
        return { error: 'sin_objetivos_a_consultar', fecha_referencia: fecha };
    }
    const resultados = await Promise.all(uniq.map(async (texto) => {
        const r = await ejecutarResumenHorasObjetivoSlaPeriodo(ctx, {
            texto_objetivo: texto,
            fecha_referencia: fecha,
        });
        return compactSlaHorasItemFromResumen(texto, r);
    }));
    const ok = resultados.filter((r) => !String(r.error ?? '').trim()).length;
    const fail = resultados.length - ok;
    return {
        fecha_referencia: fecha,
        mes_yyyy_mm: fecha.slice(0, 7),
        consultados: resultados.length,
        con_datos: ok,
        con_error: fail,
        resultados,
        nota_tras_herramienta: 'Listá cada objetivo con horas_vendidas_sla_mes, horas_ya_planificadas_turnos_mes y horas_pendientes_a_planificar. Si con_error>0, indicá el error por ítem sin decir «error técnico» genérico.',
    };
}
function esLegajoActivoComoPantallaRRHH(statusRaw) {
    const s = String(statusRaw ?? '').trim().toLowerCase();
    if (!s)
        return true;
    if (s === 'activo' || s === 'active')
        return true;
    if (s === 'inactivo' || s === 'inactive')
        return false;
    return true;
}
function esEmpleadoNominaTarjetaDashboard(statusRaw) {
    const s = String(statusRaw ?? '').trim().toLowerCase();
    return ['active', 'activo', 'activa'].includes(s);
}
async function ejecutarContarEmpleadosPlantillaEmpresa(ctx, args) {
    if (!canQueryEmpleadosPlantillaResumen(ctx)) {
        return { error: 'sin_permiso_legajos_requiere_rrhh_planificacion_operaciones_o_similar' };
    }
    const fechaRef = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
    try {
        parseYmd(fechaRef);
    }
    catch (e) {
        return { error: e?.message ?? 'fecha_invalida' };
    }
    const ym = fechaRef.slice(0, 7);
    const db = admin.firestore();
    const qsnap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(900).get();
    let activosPanelNomina = 0;
    let activosRrhhAmplio = 0;
    let inactivosExplicitos = 0;
    const muestra = [];
    for (const d of qsnap.docs) {
        const row = d.data();
        const empE = String(row.empresaId ?? '').trim();
        if (empE && empE.toLowerCase() !== ctx.empresaId.toLowerCase())
            continue;
        const st = row.status;
        if (esEmpleadoNominaTarjetaDashboard(st))
            activosPanelNomina += 1;
        if (esLegajoActivoComoPantallaRRHH(st))
            activosRrhhAmplio += 1;
        else
            inactivosExplicitos += 1;
        if (muestra.length < 12) {
            const ln = String(row.lastName ?? '').trim();
            const fn = String(row.firstName ?? '').trim();
            const name = [ln, fn].filter(Boolean).join(' ').trim() ||
                String(row.name ?? row.nombre ?? '').trim() ||
                '(sin nombre)';
            muestra.push({
                apellido_nombre: name.slice(0, 80),
                estado: String(st ?? '(vacío)').slice(0, 24),
            });
        }
    }
    return {
        fecha_referencia_para_rotulo: fechaRef,
        mes_calendario_yyyy_mm: ym,
        cuenta_para_tarjeta_panel_empleados_nomina: activosPanelNomina,
        cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado: activosRrhhAmplio,
        cuenta_legajos_inactivos_explicitos: inactivosExplicitos,
        cuenta_total_en_lote: activosRrhhAmplio + inactivosExplicitos,
        truncado_loteFirestore_900: qsnap.size >= 900,
        criterios: {
            panel_dashboard: 'cuenta_para_tarjeta_panel_empleados_nomina = legajos con status exactamente activo/active/activa (misma regla que tarjeta EMPLEADOS EN NÓMINA del panel).',
            rrhh_lista: 'cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado = activo/active o vacío u otros no marcados inactivo (lista RRHH).',
        },
        muestra_primeros_legajos: muestra,
        nota_tras_herramienta: 'Herramienta retirada del asistente: orientá al usuario a la tarjeta Empleados en nómina del Panel principal o RRHH y legajos; no devuelvas cifras desde el chat.',
    };
}
async function buildEmpresaMetricsSnapshotForPrompt(ctx, options = {}) {
    if (ctx.persona !== 'SYSTEM' || !ctx.empresaId.trim())
        return '';
    const includeOps = options.includeOperationsDay === true;
    const jobs = [];
    if (canQueryServiciosSlaResumen(ctx)) {
        jobs.push((async () => {
            try {
                const r = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, {});
                if (String(r.error ?? '').trim())
                    return [`- Servicios SLA (mes referencia): error (${String(r.error)}).`];
                return [
                    `- Contratos SLA que solapan el mes de la fecha referencia (KPI panel Servicios): ${String(r.cuenta_para_tarjeta_servicios_activos_del_mes ?? '—')}`,
                    `- Objetivos distintos con SLA en ese mes: ${String(r.cuenta_objetivos_distintos_con_sla_en_ese_mes ?? '—')}`,
                ];
            }
            catch {
                return ['- Servicios SLA (mes referencia): no disponible en este turno.'];
            }
        })());
    }
    if (includeOps && canQueryOperationsDaySummary(ctx)) {
        jobs.push((async () => {
            try {
                const r = await ejecutarResumenPresenciasObjetivosDia(ctx, {});
                if (String(r.error ?? '').trim())
                    return [`- Operaciones (día referencia): error (${String(r.error)}).`];
                const t = r.totales;
                if (!t)
                    return ['- Operaciones (día referencia): sin totales.'];
                return [
                    `- Operaciones día referencia — turnos visibles: ${String(t.turnos_visibles_en_dia ?? '—')}; presentes: ${String(t.presentes ?? '—')}; ausentes: ${String(t.ausentes ?? '—')}; sin marcación: ${String(t.sin_marcacion_relevante ?? '—')}`,
                ];
            }
            catch {
                return ['- Operaciones (día referencia): no disponible en este turno.'];
            }
        })());
    }
    if (jobs.length === 0)
        return '';
    const blocks = await Promise.all(jobs);
    const flat = blocks.flatMap((b) => (b ?? []).filter(Boolean));
    return [
        '══ MÉTRICAS YA CALCULADAS EN ESTE TURNO (priorizá estas cifras para SLA u operaciones del día cuando coincidan; no inventes otras). Para otra fecha o desglose, usá herramientas. ══',
        ...flat,
        'Para «cuántos empleados en nómina/plantilla», no des un número desde el chat: indicá la tarjeta **Empleados en nómina** del **Panel principal** o **RRHH y legajos**.',
    ].join('\n');
}
function sanitizeGeminiStruct(value, depth = 0) {
    if (depth > 10)
        return null;
    if (value === undefined)
        return null;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'object')
        return String(value);
    if (Array.isArray(value)) {
        return value.slice(0, 96).map((x) => sanitizeGeminiStruct(x, depth + 1));
    }
    const o = value;
    const entries = Object.entries(o).slice(0, 64);
    const out = {};
    for (const [k, v] of entries) {
        out[k] = sanitizeGeminiStruct(v, depth + 1);
    }
    return out;
}
async function dispatchAssistantToolCall(ctx, name, rawArgs) {
    const args = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {};
    let raw;
    try {
        raw = await dispatchAssistantToolCallInner(ctx, name, args);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[assistant] dispatch tool exception', { name, msg });
        return { error: 'excepcion_interna_herramienta', herramienta: name, detalle: msg.slice(0, 320) };
    }
    return sanitizeGeminiStruct(raw);
}
async function dispatchAssistantToolCallInner(ctx, name, args) {
    let raw;
    if (name === 'buscar_empleados_por_nombre') {
        raw = await ejecutarBuscarEmpleadosPorNombre(ctx, {
            texto: String(args.texto ?? ''),
            limite: args.limite != null ? Number(args.limite) : undefined,
        });
    }
    else if (name === 'listado_empleados_empresa') {
        raw = await ejecutarListadoEmpleadosEmpresa(ctx, {
            filtro_texto: args.filtro_texto != null ? String(args.filtro_texto) : undefined,
            limite: args.limite != null ? Number(args.limite) : undefined,
            solo_activos_nomina_panel: args.solo_activos_nomina_panel === true,
        });
    }
    else if (name === 'buscar_objetivos_por_nombre') {
        raw = await ejecutarBuscarObjetivosPorNombre(ctx, {
            texto: String(args.texto ?? ''),
            limite: args.limite != null ? Number(args.limite) : undefined,
        });
    }
    else if (name === 'consultar_turnos_empleado') {
        raw = await ejecutarConsultarTurnosEmpleado(ctx, {
            id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
            fecha_desde: String(args.fecha_desde ?? ''),
            fecha_hasta: String(args.fecha_hasta ?? ''),
        });
    }
    else if (name === 'resumen_presencias_objetivos_dia') {
        raw = await ejecutarResumenPresenciasObjetivosDia(ctx, {
            fecha: args.fecha != null ? String(args.fecha) : undefined,
            id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
        });
    }
    else if (name === 'listado_turnos_operativos_dia') {
        raw = await ejecutarListadoTurnosOperativosDia(ctx, {
            fecha: args.fecha != null ? String(args.fecha) : undefined,
            id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
            limite: args.limite != null ? Number(args.limite) : undefined,
        });
    }
    else if (name === 'listado_franco_ret_dia') {
        raw = await ejecutarListadoFrancoRetDia(ctx, {
            fecha: args.fecha != null ? String(args.fecha) : undefined,
            tipo: args.tipo != null ? String(args.tipo) : undefined,
            id_objetivo_cercania: args.id_objetivo_cercania != null ? String(args.id_objetivo_cercania) : undefined,
            limite: args.limite != null ? Number(args.limite) : undefined,
        });
    }
    else if (name === 'contar_servicios_sla_vigentes_empresa') {
        raw = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, {
            fecha: args.fecha != null ? String(args.fecha) : undefined,
        });
    }
    else if (name === 'contar_empleados_plantilla_empresa') {
        raw = {
            no_disponible_en_asistente: true,
            orientacion: 'El total de empleados en nómina no se consulta desde el chat. Indicá al usuario la tarjeta Empleados en nómina del Panel principal o el módulo RRHH y legajos.',
        };
    }
    else if (name === 'resumen_horas_empleado_periodo') {
        let fechaDesde = String(args.fecha_desde ?? '').trim();
        let fechaHasta = String(args.fecha_hasta ?? '').trim();
        if (!fechaDesde || !fechaHasta) {
            try {
                const p = parseYmd(ctx.referenceDateYsMmDd);
                const mm = String(p.m).padStart(2, '0');
                const lastD = new Date(p.y, p.m, 0).getDate();
                fechaDesde = `${p.y}-${mm}-01`;
                fechaHasta = `${p.y}-${mm}-${String(lastD).padStart(2, '0')}`;
            }
            catch {
            }
        }
        raw = await ejecutarResumenHorasEmpleadoPeriodo(ctx, {
            id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
            fecha_desde: fechaDesde,
            fecha_hasta: fechaHasta,
        });
    }
    else if (name === 'resumen_horas_objetivo_sla_periodo') {
        raw = await ejecutarResumenHorasObjetivoSlaPeriodo(ctx, {
            id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
            texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
            fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
            id_servicio_sla: args.id_servicio_sla != null ? String(args.id_servicio_sla) : undefined,
        });
    }
    else if (name === 'resumen_horas_sla_varios_objetivos') {
        const rawTextos = args.textos_objetivo;
        const textosArr = Array.isArray(rawTextos)
            ? rawTextos.map((x) => String(x))
            : rawTextos != null
                ? [String(rawTextos)]
                : undefined;
        raw = await ejecutarResumenHorasSlaVariosObjetivos(ctx, {
            textos_objetivo: textosArr,
            fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
            todos_servicios_activos_mes: args.todos_servicios_activos_mes === true,
            limite: args.limite != null ? Number(args.limite) : undefined,
        });
    }
    else {
        raw = { error: 'herramienta_desconocida', name };
    }
    return raw;
}
//# sourceMappingURL=assistantDataTools.js.map