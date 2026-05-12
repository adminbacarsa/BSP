import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface GeminiCorreccion {
    empId: string;
    fecha: string;        // YYYY-MM-DD
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

export interface PlannerContext {
    mes: string;                   // YYYY-MM
    objetivo: string;
    slaVendidas: number;           // horas vendidas en el contrato
    puestos: any[];
    empleados: any[];              // incluye horasMes y horasCola (mes anterior)
    dias: string[];                // todos los días del mes YYYY-MM-DD
    diasBloqueados: string[];      // días pasados/cerrados, no tocar
    planificacionCompleta: any;    // empId → [{fecha, codigo, puesto}] TODOS los días
    ausencias: any;                // empId → {fecha: código}
    coberturaPorDia: any;          // fecha → puesto → {actual, requerido, deficit}
}

// ─── System Prompt (fijo entre llamadas, se cachea en Gemini) ─────────────────

const SYSTEM_PROMPT = `Sos un optimizador experto de planificaciones de turnos para empresas de seguridad privada en Argentina (CCT 422/05, convenio SUVICO).

Recibís un cronograma ya generado y devolvés TODAS las correcciones necesarias para que cumpla las reglas. Tu única salida es JSON válido. No incluyas texto fuera del JSON, ni markdown, ni comentarios.

═══════════════════════════════════════════════════
REGLAS DURAS (no se violan jamás)
═══════════════════════════════════════════════════

R1. COBERTURA: para cada (puesto, día activo): empleados con turno facturable >= pos.qty. Nunca reduzcas cobertura por debajo del mínimo requerido.

R2. HORAS VENDIDAS: el total de horas facturables del mes debe acercarse lo máximo posible a slaVendidas (dentro del 2%). Prioridad máxima después de R1.

R3. TOPES CCT: nunca superes 200h mensuales por empleado en jornadas de 8h, ni 192h en jornadas de 12h. El campo horasMes ya incluye lo acumulado; sumale las horas de cada corrección antes de proponerla.

R4. DESCANSOS MÍNIMOS: 12h entre fin de turno e inicio del siguiente.
   - N (termina 07:00 del día siguiente) → el día siguiente NO puede ser: M (07:00), D12 (07:00), T (15:00).
   - N12 (termina 07:00 del día siguiente) → misma restricción.
   - Si proponés un turno el día D+1, verificá que el turno del día D no sea nocturno terminando en conflicto.

R5. EQUIDAD: diferencia máxima entre el empleado con más y menos horas del mismo puesto: 16h. Si superan 16h, priorizá Franco (F) al más cargado en días donde la cobertura lo permita.

R6. PROMOCIÓN RET → TURNO FACTURABLE: si deficit > 0 en un puesto un día, promové el empleado en RET de ese puesto (o cualquier posición si no hay del mismo puesto) con MENOS horasMes a turno facturable. Esta regla tiene prioridad sobre R5.

R7. TURNO FACTURABLE → F: solo si actual > requerido en ese puesto ese día Y el empleado tiene más horas que el promedio del puesto.

R8. AUSENCIAS: nunca modifiques una celda que tenga código de ausencia (V, L, A, E, AA, PG). Esas fechas son intocables.

R9. DÍAS BLOQUEADOS: no generes correcciones para fechas en diasBloqueados.

R10. CÓDIGOS VÁLIDOS: para turnos facturables, SOLO podés usar códigos que aparezcan en el campo 'shifts[]' del puesto en los datos enviados. Para no facturables, SOLO podés usar: F, FF, FP, RET. Cualquier otro código (inventado, deducido, o de otro puesto) es inválido y será rechazado. Nunca uses "RO", "EN", "TN", ni ningún otro código que no aparezca explícitamente en la lista de turnos del puesto.

═══════════════════════════════════════════════════
PROCESO DE OPTIMIZACIÓN
═══════════════════════════════════════════════════

Paso 1 — Verificación estructural:
   Si Nemp × 200h < slaVendidas con margen > 5%: bloqueoEstructural=true, correcciones vacías.
   Si cobertura mínima imposible con los empleados disponibles: bloqueoEstructural=true.

Paso 2 — Recorrido completo (todos los empleados, todos los días):
   a) Para cada día con deficit > 0 en algún puesto: aplicar R6 (RET → facturable).
   b) Para cada empleado con horasMes muy por debajo del promedio y hay deficit: asignar turno facturable.
   c) Para cada par de empleados del mismo puesto con diferencia > 16h: aplicar R5 (Franco al más cargado si la cobertura lo permite).
   d) Para cada día con turno nocturno seguido de turno conflictivo: corregir con R4.

Paso 3 — Validación interna antes de responder:
   Verificá que cada corrección propuesta no viole R1-R10. Si viola alguna, no la incluyas.`;

// ─── User Prompt (variables del mes/objetivo) ─────────────────────────────────

function buildUserPrompt(context: PlannerContext): string {
    return `MES: ${context.mes}
OBJETIVO: ${context.objetivo}
SLA_VENDIDAS_HS: ${context.slaVendidas}

PUESTOS — lista exacta de códigos permitidos por puesto (R10: solo podés usar estos códigos):
${context.puestos.map(p => {
    const billable = (p.shifts || []).map((s: any) => s.code).join(', ') || 'M';
    return `  ${p.positionName}: facturables=[${billable}] | no-facturables=[F, FF, FP, RET] | qty=${p.qty} | días=${p.activeDays}`;
}).join('\n')}

PUESTOS (datos completos):
${JSON.stringify(context.puestos, null, 2)}

EMPLEADOS (id, nombre, puestoAsignado, horasMes=horas facturables acumuladas este mes, diferenciaProm=diferencia vs promedio del puesto — negativo=menos horas que el promedio):
${JSON.stringify(context.empleados, null, 2)}

DÍAS DEL MES:
${JSON.stringify(context.dias)}

DÍAS BLOQUEADOS (no generar correcciones para estas fechas):
${JSON.stringify(context.diasBloqueados)}

PLANIFICACIÓN ACTUAL — cronograma completo (empId → [{fecha, codigo, puesto}]):
${JSON.stringify(context.planificacionCompleta, null, 2)}

AUSENCIAS (empId → {fecha: código} — no tocar):
${JSON.stringify(context.ausencias, null, 2)}

COBERTURA POR DÍA (fecha → puesto → {actual, requerido, deficit}):
${JSON.stringify(context.coberturaPorDia, null, 2)}

INSTRUCCIÓN:
Revisá el cronograma completo. Generá TODAS las correcciones necesarias (sin límite) para que:
1. Cada puesto activo tenga cobertura >= requerido TODOS los días (R1) — promover RET a turno facturable en días con déficit
2. Las horas facturables totales se acerquen a SLA_VENDIDAS_HS dentro del 2% (R2)
3. La diferencia de horas entre empleados del mismo puesto no supere 16h (R5)
4. No haya violaciones de descanso nocturno→mañana (R4)

CRÍTICO (R10): el campo "codigoNuevo" DEBE ser uno de los códigos listados arriba para ese puesto.
Para facturables: usa EXACTAMENTE el código de la lista 'facturables=[...]' del puesto.
Para no facturables: usa SOLO F, FF, FP o RET.
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
      "razon": "breve: qué problema resuelve"
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

// ─── Llamada a la API ─────────────────────────────────────────────────────────

export async function optimizarConGemini(context: PlannerContext): Promise<GeminiRespuesta> {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) throw new Error('NEXT_PUBLIC_GEMINI_API_KEY no configurada en .env.local');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
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
    if (!match) throw new Error(`Gemini no devolvió JSON válido: ${text.slice(0, 300)}`);

    try {
        return JSON.parse(match[0]) as GeminiRespuesta;
    } catch {
        // Intentar reparar JSON truncado
        let fixed = match[0];
        const lastComplete = fixed.lastIndexOf('},');
        if (lastComplete > 0) fixed = fixed.slice(0, lastComplete + 1);
        const ob  = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
        const ob2 = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
        for (let i = 0; i < ob2; i++) fixed += ']';
        for (let i = 0; i < ob;  i++) fixed += '}';
        try {
            return JSON.parse(fixed) as GeminiRespuesta;
        } catch {
            throw new Error(`JSON inválido de Gemini: ${text.slice(0, 300)}`);
        }
    }
}
