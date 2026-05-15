/**
 * Gemini optimización planificación — sólo en servidor (misma API key que asistente).
 * Duplica la lógica de web2/services/geminiPlanificacion.ts para no llamar Gemini desde el browser.
 */

import * as functions from 'firebase-functions/v1';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiCorreccion {
  empId: string;
  fecha: string;
  codigoNuevo: string;
  puesto: string;
  razon: string;
}

export interface GeminiMetricas {
  totalHsFacturables: number;
  diasConDeficit: string[];
  empleadosFueraDeEquidad: string[];
}

export interface GeminiRespuesta {
  bloqueoEstructural: boolean;
  razonBloqueo: string | null;
  correcciones: GeminiCorreccion[];
  metricas: GeminiMetricas | null;
  resumen: string;
}

/** Espejo del tipo en web2 (payload callable). */
export interface PlannerContext {
  mes: string;
  objetivo: string;
  slaVendidas: number;
  puestos: any[];
  empleados: any[];
  dias: string[];
  diasBloqueados: string[];
  planificacionCompleta: any;
  ausencias: any;
  coberturaPorDia: any;
  cicloCCT?: {
    cortePrev: string;
    corteActual: string;
    descripcion: string;
  };
  autoCycles?: any[];
}

function maxHorasFacturablesDiaPorPuesto(p: any): number {
  const qty = Math.max(1, Number(p?.qty) || 1);
  const cov = String(p?.coverageType || 'custom').toLowerCase();
  if (cov === '24hs' || cov === '24' || cov === '24h') return qty * 24;
  const shiftsArr = Array.isArray(p?.shifts) ? p.shifts : [];
  const sumHs = shiftsArr.reduce((acc: number, s: any) => acc + (Number(s.hours) || 8), 0);
  const banda = sumHs > 0 ? sumHs : 8;
  return qty * banda;
}

const SYSTEM_PROMPT = `Sos un asistente de AJUSTE FINO de cronogramas de seguridad privada en Argentina (CCT 422/05).

IMPORTANTE: NO inventás un cronograma nuevo desde cero. Solo proponés correcciones puntuales (cambios de celda) que mejoren cobertura, equidad y cumplimiento legal, sin inflar horas de más en ningún puesto.

Tu única salida es JSON válido. Sin markdown, sin texto fuera del JSON.

═══════════════════════════════════════════════════
REGLAS DURAS (no negociables)
═══════════════════════════════════════════════════

R1. COBERTURA MÍNIMA: en cada (puesto, día en que el puesto opera según activeDays): debe haber al menos tantos turnos facturables distintos como indica pos.qty (según la métrica que ya recibís en coberturaPorDia). Nunca dejes déficit al bajar cobertura.

R10. TOPE DE HORAS FACTURABLES POR PUESTO Y DÍA (crítico):
   - Para cada puesto P y cada fecha D, la SUMA de horas facturables de TODOS los empleados asignados a P ese día NO puede superar el tope que recibís en el bloque "TOPE_HS_FACTURABLES_POR_PUESTO_Y_DIA".
   - Eso equivale a: no agregar suplentes de más, no duplicar bandas, no "rellenar" con turnos extra cuando ya se cubrió la demanda diaria del SLA.
   - Si ya se alcanzó el tope de horas en P ese día, la única acción permitida es redistribuir (swap), bajar a F/RET, o mover a otro día — jamás sumar más horas en ese (P,D).

R2. SLA_VENDIDAS: es referencia mensual de contrato. NO la uses para justificar pasarte del tope diario R10 en un puesto. Preferí equidad y legalidad antes que inflar un día.

R3. TOPES CCT POR CICLO: 200h por ciclo CCT (26 del mes anterior → 25 del mes actual para el tramo "current"; 26→fin del mes en "next"). Respetá priorHoursCiclo + horas del mes según el día de la corrección.

R4. DESCANSOS: 12h entre fin de turno e inicio del siguiente (8h solo si el turno previo fue ≤6h).

R5. CAP SEMANAL: máximo 60h/semana ISO; emergencia hasta 72h sin romper R3 ni R4.

R6. AUSENCIAS: no tocar celdas V, L, A, E, AA, PG.

R7. diasBloqueados: no generar correcciones para esas fechas.

R8. CÓDIGOS: solo códigos en shifts[].code del puesto para facturables; para no facturables solo F, FF, FP, RET.

R9. OWNER en puesto limitado (L-V, etc.): días que el puesto no opera → el owner solo F; días que opera → priorizar su turno; suplente a RET/F si hace falta consolidar.

═══════════════════════════════════════════════════
QUÉ SÍ PODÉS HACER (prioridad)
═══════════════════════════════════════════════════

P1. Consolidar owner vs suplente (swap) sin violar R10.
P2. Cubrir déficit real (deficit>0 en coberturaPorDia) promoviendo RET→facturable, siempre dentro de R10, R3, R4, R5.
P3. Equidad intra-puesto (reducir diferencia de horasMes) con swaps que no rompan R10.
P4. Jamás agregar un turno facturable extra en un (puesto,día) que ya cumple o supera el tope R10.

═══════════════════════════════════════════════════
PROCESO
═══════════════════════════════════════════════════

1) Detectar violaciones de R9 y corregir.
2) Para cada día con deficit>0 en coberturaPorDia: P2 respetando R10 (si el tope ya está lleno, no agregues más horas en ese puesto; buscá swap o otro puesto/día).
3) Equidad P3.
4) Autochequeo: ninguna corrección puede violar R1,R3,R4,R5,R6,R7,R8,R9,R10. Si una corrección la rompe, no la incluyas.

Paso final: JSON según el esquema pedido en el mensaje del usuario.`;

function buildUserPrompt(context: PlannerContext): string {
  const topeHsPorPuesto = Object.fromEntries(
    (context.puestos || []).map((p: any) => [p.positionName, maxHorasFacturablesDiaPorPuesto(p)]),
  );
  return `MES: ${context.mes}
OBJETIVO: ${context.objetivo}
SLA_VENDIDAS_HS: ${context.slaVendidas}

CICLO_CCT: ${context.cicloCCT?.descripcion || 'No especificado (asumir mes calendario)'}
${context.cicloCCT ? `  cortePrev = ${context.cicloCCT.cortePrev}\n  corteActual = ${context.cicloCCT.corteActual}` : ''}

CICLOS_AUTORIZADOS (autoCycles seleccionados): ${context.autoCycles ? JSON.stringify(context.autoCycles.map((c: any) => c.id || c.name || c)) : '[]'}

TOPE_HS_FACTURABLES_POR_PUESTO_Y_DIA (R10 — suma máxima de horas facturables en ese puesto cualquier día activo):
${JSON.stringify(topeHsPorPuesto, null, 2)}

PUESTOS — lista exacta de códigos permitidos por puesto (R8: solo podés usar estos códigos):
${context.puestos.map((p) => {
    const billable = (p.shifts || []).map((s: any) => s.code).join(', ') || 'M';
    const days = Array.isArray(p.activeDays) ? p.activeDays.join(',') : 'todos';
    const opera7 = Array.isArray(p.activeDays) ? p.activeDays.length === 7 : true;
    return `  ${p.positionName}: facturables=[${billable}] | no-facturables=[F, FF, FP, RET] | qty=${p.qty} | días=${days} ${opera7 ? '(7 días)' : '(LIMITADO)'} | topeHsDia=${maxHorasFacturablesDiaPorPuesto(p)}`;
}).join('\n')}

PUESTOS (datos completos):
${JSON.stringify(context.puestos, null, 2)}

EMPLEADOS — campos clave:
  - id, nombre
  - puestoAsignado: puesto donde se lo está usando este mes
  - defaultPos: puesto FIJO/PREDETERMINADO (R9). Si null y es único en su grupo, considerar owner virtual.
  - ownerVirtual: true si es único empleado del grupo de un puesto qty=1.
  - horasMes: horas facturables acumuladas en el mes calendario actual.
  - priorHoursCiclo: horas del ciclo CCT que cayeron en el mes ANTERIOR (días 26..fin). Sumadas con las del 1..25 del mes actual = uso ciclo actual.
  - diferenciaProm: diferencia con promedio del puesto (negativo = menos).
${JSON.stringify(context.empleados, null, 2)}

DÍAS DEL MES:
${JSON.stringify(context.dias)}

DÍAS BLOQUEADOS (R7 — no generar correcciones para estas fechas):
${JSON.stringify(context.diasBloqueados)}

PLANIFICACIÓN ACTUAL — cronograma completo (empId → [{fecha, codigo, puesto}]):
${JSON.stringify(context.planificacionCompleta, null, 2)}

AUSENCIAS (R6 — no tocar):
${JSON.stringify(context.ausencias, null, 2)}

COBERTURA POR DÍA (fecha → puesto → {actual, requerido, deficit, retDisponibles}):
${JSON.stringify(context.coberturaPorDia, null, 2)}

INSTRUCCIÓN:
Revisá el cronograma. Solo incluí correcciones que cumplan TODAS las reglas duras (en especial R10: antes de agregar un turno facturable en (puesto,fecha), calculá la suma de horas facturables que quedaría ese día en ese puesto y no superés el tope).

Orden sugerido:
1) R9 (owners limitados)
2) P1 consolidación owner/suplente sin pasar R10
3) P2 déficit real (deficit>0) sin pasar R10
4) P3 equidad con swaps

CRÍTICO (R8): "codigoNuevo" DEBE ser uno de los códigos listados arriba para ese puesto.
  - Para facturables: usá EXACTAMENTE el código de la lista 'facturables=[...]' del puesto.
  - Para no facturables: usá SOLO F, FF, FP o RET.
NO uses ningún otro código. Las correcciones con código inválido son automáticamente rechazadas.

Respondé ÚNICAMENTE con este JSON:
{
  "bloqueoEstructural": false,
  "razonBloqueo": null,
  "correcciones": [
    {
      "empId": "id_exacto_del_empleado",
      "fecha": "YYYY-MM-DD",
      "codigoNuevo": "codigo_exacto_de_la_lista",
      "puesto": "nombre_exacto_del_puesto",
      "razon": "breve: qué problema resuelve (R9, P1, P2, P3, R10)"
    }
  ],
  "metricas": {
    "totalHsFacturables": 0,
    "diasConDeficit": [],
    "empleadosFueraDeEquidad": []
  },
  "resumen": "2-3 oraciones describiendo los cambios principales"
}

Si la dotación es insuficiente para cumplir cobertura y vendidas simultáneamente:
{
  "bloqueoEstructural": true,
  "razonBloqueo": "descripción del problema estructural con números concretos",
  "correcciones": [],
  "metricas": null,
  "resumen": "..."
}`;
}

const PLANNING_MODEL = process.env.GEMINI_PLANNING_MODEL?.trim() || 'gemini-2.5-flash';

export async function runPlanningGeminiOptimize(context: PlannerContext): Promise<GeminiRespuesta> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const emu = process.env.FUNCTIONS_EMULATOR === 'true';
    throw new functions.https.HttpsError(
      'failed-precondition',
      emu
        ? 'Emulador: falta GEMINI_API_KEY en apps/functions/.env'
        : 'GEMINI_API_KEY no configurada (Secret Manager).',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: PLANNING_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.0,
      maxOutputTokens: 32000,
    } as any,
  });

  const result = await model.generateContent(buildUserPrompt(context));
  const text = result.response.text();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new functions.https.HttpsError(
      'internal',
      `Gemini no devolvió JSON válido: ${text.slice(0, 300)}`,
    );
  }

  try {
    return JSON.parse(match[0]) as GeminiRespuesta;
  } catch {
    let fixed = match[0];
    const lastComplete = fixed.lastIndexOf('},');
    if (lastComplete > 0) fixed = fixed.slice(0, lastComplete + 1);
    const ob = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    const ob2 = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    for (let i = 0; i < ob2; i++) fixed += ']';
    for (let i = 0; i < ob; i++) fixed += '}';
    try {
      return JSON.parse(fixed) as GeminiRespuesta;
    } catch {
      throw new functions.https.HttpsError('internal', `JSON inválido de Gemini: ${text.slice(0, 300)}`);
    }
  }
}
