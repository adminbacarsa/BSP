"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEventualesParaHueco = loadEventualesParaHueco;
exports.registrarAsignacionEventualEnBatch = registrarAsignacionEventualEnBatch;
const firestore_1 = require("firebase-admin/firestore");
const arClock_1 = require("../common/arClock");
const eventoCoverage_1 = require("./eventoCoverage");
function msOf(value) {
    if (value instanceof firestore_1.Timestamp)
        return value.toMillis();
    if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    if (value && typeof value === 'object' && typeof value.seconds === 'number') {
        return value.seconds * 1000;
    }
    return 0;
}
function hmAr(ms) {
    const d = new Date(ms - arClock_1.AR_OFFSET_MS);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}
async function loadEventualesParaHueco(db, shift) {
    const empresaId = String(shift.empresaId || '').trim();
    const startMs = msOf(shift.startTime);
    const endMs = msOf(shift.endTime);
    if (!empresaId || !startMs || !endMs)
        return [];
    const snap = await db.collection('eventuales_bolsa').where('disponibilidad', '==', 'DISPONIBLE').get();
    const bolsa = snap.docs.map((d) => {
        const data = d.data();
        return { ...data, cuil: String(data.cuil || d.id) };
    });
    const cuils = bolsa.map((b) => b.cuil).filter(Boolean);
    const otras = [];
    for (let i = 0; i < cuils.length; i += 10) {
        const chunk = cuils.slice(i, i + 10);
        if (!chunk.length)
            continue;
        const turns = await db.collection('turnos').where('bolsaCuil', 'in', chunk).get();
        for (const doc of turns.docs) {
            const data = doc.data();
            if (data.draft === true || data.isDeleted === true || data.status === 'INACTIVE')
                continue;
            const s = msOf(data.startTime);
            const e = msOf(data.endTime);
            if (!s || !e || e <= s)
                continue;
            otras.push({
                cuil: String(data.bolsaCuil || ''),
                empresaId: String(data.empresaId || ''),
                startMs: s,
                endMs: e,
            });
        }
    }
    const lat = Number(shift.lat ?? shift.latitude);
    const lng = Number(shift.lng ?? shift.longitude);
    return (0, eventoCoverage_1.eventualesParaHueco)({
        bolsa,
        hueco: {
            empresaId,
            startMs,
            endMs,
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
            hoyYmd: (0, arClock_1.arYmd)(Date.now()),
        },
        otrasJornadas: otras,
    });
}
async function registrarAsignacionEventualEnBatch(db, batch, opts) {
    const cuil = String(opts.cuil || '').trim();
    const bolsaSnap = await db.collection('eventuales_bolsa').doc(cuil).get();
    if (!bolsaSnap.exists)
        throw new Error('EVENTUAL_SIN_BOLSA');
    const pool = await loadEventualesParaHueco(db, {
        empresaId: opts.empresaId,
        startTime: firestore_1.Timestamp.fromMillis(opts.startMs),
        endTime: firestore_1.Timestamp.fromMillis(opts.endMs),
    });
    if (!pool.some((p) => p.cuil === cuil))
        throw new Error('EVENTUAL_CRUCE_BLOQUEADO');
    const fecha = (0, arClock_1.arYmd)(opts.startMs);
    const fechaBaja = (0, arClock_1.arYmd)(opts.endMs);
    const jornada = {
        fecha,
        horaInicio: hmAr(opts.startMs),
        horaFin: hmAr(opts.endMs),
        horas: Math.round(((opts.endMs - opts.startMs) / 3600000) * 100) / 100,
        empresaId: opts.empresaId,
    };
    const previos = await db.collection('contratos_eventuales').where('bolsaCuil', '==', cuil).get();
    const abierto = previos.docs.find((d) => {
        const data = d.data();
        return data.empresaId === opts.empresaId && data.status === 'ACTIVE' && data.estado === 'CONFIRMADO';
    });
    let contratoId;
    if (abierto) {
        contratoId = abierto.id;
        const prev = abierto.data().jornadas || [];
        batch.update(abierto.ref, {
            jornadas: [...prev, jornada],
            fechaBaja,
            employeeId: opts.employeeId,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    else {
        const ref = db.collection('contratos_eventuales').doc();
        contratoId = ref.id;
        batch.set(ref, {
            empresaId: opts.empresaId,
            bolsaCuil: cuil,
            employeeId: opts.employeeId,
            employeeName: opts.employeeName,
            estado: 'CONFIRMADO',
            origen: 'CENTRO_CONTROL',
            fechaAlta: fecha,
            fechaBaja,
            jornadas: [jornada],
            status: 'ACTIVE',
            causa: 'COBERTURA_CC',
            shiftId: opts.shiftId,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    const envioRef = db.collection('arca_envios').doc();
    batch.set(envioRef, {
        empresaId: opts.empresaId,
        contratoId,
        bolsaCuil: cuil,
        tipo: 'AT',
        estado: 'PENDIENTE',
        canal: 'URGENTE',
        shiftId: opts.shiftId,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    batch.update(db.collection('turnos').doc(opts.covDocId), {
        esEventual: true,
        eventualAltaArcaConfirmada: false,
        eventualContratoId: contratoId,
        bolsaCuil: cuil,
        arcaEnvioId: envioRef.id,
    });
}
//# sourceMappingURL=eventualesParaHuecoServer.js.map