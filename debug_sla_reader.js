const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
// Asegúrate de tener tu serviceAccountKey.json en la raíz del proyecto
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function runAudit() {
    console.log("🔍 INICIANDO DIAGNÓSTICO DE DATOS (CLIENTES vs TURNOS)...");

    // 1. DEFINIR RANGO DE TIEMPO (HOY)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`📅 Fecha de análisis: ${startOfDay.toLocaleDateString()}`);

    // 2. OBTENER TURNOS DE HOY
    console.log("⏳ Descargando turnos...");
    const shiftsSnap = await db.collection('turnos')
        .where('startTime', '>=', startOfDay)
        .where('startTime', '<=', endOfDay)
        .get();
    
    const shifts = shiftsSnap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        // Convertimos fechas a string para que el JSON sea legible
        startTime: d.data().startTime?.toDate().toISOString(),
        endTime: d.data().endTime?.toDate().toISOString()
    }));
    console.log(`✅ Turnos encontrados hoy: ${shifts.length}`);

    // 3. OBTENER CLIENTES (SLA)
    console.log("⏳ Descargando configuración de clientes...");
    const clientsSnap = await db.collection('clients').get();
    const rawClients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 4. PROCESAR Y COMPARAR
    const report = {
        meta: {
            timestamp: new Date().toISOString(),
            total_turnos_hoy: shifts.length,
            total_clientes: rawClients.length
        },
        analisis_detallado: []
    };

    rawClients.forEach(client => {
        // Normalizamos si la estructura está en el root o en objetivos
        const objetivos = client.objetivos || [{ name: client.name, id: 'root', structure: client.structure || client.puestos || [] }];

        objetivos.forEach(obj => {
            const analisisObjetivo = {
                cliente: client.name,
                objetivo: obj.name,
                estructura_raw: [], // Para ver qué lee exactamente el código
                conclusiones: []
            };

            const structure = obj.structure || client.structure || [];

            if (!Array.isArray(structure) || structure.length === 0) {
                analisisObjetivo.conclusiones.push("⚠️ SIN ESTRUCTURA DEFINIDA EN DB");
            } else {
                structure.forEach(puesto => {
                    // DATOS CRUDOS DEL PUESTO (Aquí veremos si dice 'quantity: 3' o no)
                    analisisObjetivo.estructura_raw.push(puesto);

                    const qtyRequerida = parseInt(puesto.quantity || 1, 10);
                    
                    // Buscar turnos que coincidan
                    const matches = shifts.filter(s => 
                        (s.objectiveId === obj.id || s.objectiveName === obj.name) &&
                        (s.positionId === puesto.id || s.positionName === puesto.name || s.position === puesto.name)
                    );

                    const estado = {
                        puesto_nombre: puesto.name,
                        cantidad_requerida_db: qtyRequerida,
                        cantidad_encontrada_turnos: matches.length,
                        diferencia: matches.length - qtyRequerida,
                        ids_turnos_encontrados: matches.map(m => m.id),
                        status: matches.length >= qtyRequerida ? "OK" : "FALTA CUBRIR"
                    };

                    analisisObjetivo.conclusiones.push(estado);
                });
            }

            report.analisis_detallado.push(analisisObjetivo);
        });
    });

    // 5. GUARDAR JSON
    const outputFile = path.join(__dirname, 'debug_output.json');
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    
    console.log(`\n💾 REPORTE GENERADO: ${outputFile}`);
    console.log("👉 Abre este archivo para ver exactamente qué propiedad 'quantity' está leyendo el sistema.");
}

runAudit().catch(console.error);