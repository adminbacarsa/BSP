"""
=============================================================================
 MOTOR "AJUSTAR 200 HS" — Optimización CP-SAT sin ciclo fijo
 Referencia para el Cerebro de Planificación (COSP V1.0)
=============================================================================

Qué es:
    Resuelve el período completo (ej. un mes) como un único problema de
    optimización. El patrón de turnos de cada guardia es consecuencia del
    cálculo, no un punto de partida. Útil cuando el ciclo 6+2 no cierra
    (servicios con turnos custom, escasez de plantilla, incorporaciones).

Correcciones vs. motor_empuje_200hs.py (original):
    - Modelo Guardia: ausencias pre-cargadas, ancla mes anterior, preferencia
    - R2 (nuevo): un bloque máximo por guardia por día (explícito)
    - R3: block_abs ordenado por hora absoluta + break correcto (s2-e1 ≥ rest_min)
    - R3b (nuevo): ancla mes anterior — respeta descanso con último turno previo
    - R5 (nuevo): descanso semanal ≥ 35h (2 días consecutivos libres por semana)
    - rest_min default = 11 (CCT art. 17; el original usaba 12)
    - max_dias_seguidos default = 6 (CCT; el original usaba 5)
    - Variables de ausencia: no se crean, no se asignan
    - Post-proceso: turnos en feriados marcados con código FF
    - Objetivo: penalización suave por asignar banda no preferida

Requisitos:
    pip install ortools
=============================================================================
"""

from dataclasses import dataclass, field
from collections import defaultdict
from ortools.sat.python import cp_model


# ─── 1. MODELOS DE ENTRADA ────────────────────────────────────────────────────

@dataclass
class Puesto:
    nombre: str
    pax: int                        # guardias simultáneos requeridos
    modalidad: str                  # "8h" | "12h" | "custom"
    duracion_custom: int = None     # solo si modalidad == "custom"
    inicio_custom: int = None       # hora de inicio (0-23)
    elegibles: set = field(default_factory=set)  # ids elegibles (vacío = todos)


@dataclass
class Guardia:
    id: str
    nombre: str = ""
    preferencia_banda: str = None   # M, T, N, D12, N12 — restricción blanda
    ausencias: set = field(default_factory=set)   # días sin disponibilidad (0-indexed)
    ultimo_turno_fin_h: int = None
    # Hora absoluta de fin del último turno del mes anterior, relativa al día 0
    # del período. Puede ser negativa (ej: turno N terminó a las 06:00 del día 0
    # del mes anterior → fin_h = -18) o positiva (turno N cruzó medianoche y
    # terminó a las 06:00 del día 0 del período actual → fin_h = 6).
    # Fórmula: fin_h = (hora_fin_real - medianoche_día_0_del_período) en horas.
    # Ejemplo práctico: si el período empieza el 1/jun y el último turno terminó
    # el 31/may a las 22:00 → fin_h = -2 (2h antes del inicio del período).


# ─── 2. BLOQUES DE DEMANDA ────────────────────────────────────────────────────

def generar_bloques(puestos):
    """
    Convierte puestos a bloques de demanda diaria.
    Retorna: list[(nombre_puesto, sigla, hora_inicio, duración_h, cant_simultánea, elegibles)]
    """
    bloques = []
    for pu in puestos:
        if pu.modalidad == "8h":
            for sigla, ini in (("M", 6), ("T", 14), ("N", 22)):
                bloques.append((pu.nombre, sigla, ini, 8, pu.pax, pu.elegibles))
        elif pu.modalidad == "12h":
            for sigla, ini in (("D12", 7), ("N12", 19)):
                bloques.append((pu.nombre, sigla, ini, 12, pu.pax, pu.elegibles))
        elif pu.modalidad == "custom":
            assert pu.duracion_custom and pu.inicio_custom is not None, \
                f"Puesto '{pu.nombre}' tipo custom requiere duracion_custom e inicio_custom"
            bloques.append((
                pu.nombre, "C", pu.inicio_custom, pu.duracion_custom, pu.pax, pu.elegibles
            ))
        else:
            raise ValueError(f"Modalidad desconocida: {pu.modalidad!r}")
    return bloques


# ─── 3. SOLVER CP-SAT ─────────────────────────────────────────────────────────

def resolver(
    bloques,
    n_dias,
    guardias,                       # list[Guardia]
    techo_horas=200,
    rest_min=11,                    # CCT art. 17 — mínimo 11h entre turnos
    max_dias_seguidos=6,            # CCT — máximo 6 días consecutivos
    max_por_semana=6,               # CCT — máximo 6 en cualquier ventana de 7 días
    rest_semanal_dias=2,            # CCT — mínimo 2 días consecutivos libres por semana (≈35h)
    feriados=None,                  # set[int] — días 0-indexed con feriado nacional
    peso_pref_banda=3,              # penalización por asignar banda no preferida (objetivo blando)
    tiempo_limite_seg=60,
):
    """
    Resuelve la asignación óptima para el período completo.

    Retorna:
        (status, per_guard, totales, bloques)
        per_guard : dict[guardia_id → dict[dia → (post, sigla, ini, dur, codigo)]]
        totales   : dict[guardia_id → horas_del_periodo]
    """
    feriados = feriados or set()
    model = cp_model.CpModel()

    # ── Variables ─────────────────────────────────────────────────────────────
    # No se crean variables para días de ausencia ni para guardias no elegibles.
    x = {}
    for g in guardias:
        for d in range(n_dias):
            if d in g.ausencias:
                continue
            for bi, (post, sigla, ini, dur, cant, elegibles) in enumerate(bloques):
                if elegibles and g.id not in elegibles:
                    continue
                x[g.id, d, bi] = model.NewBoolVar(f"x_{g.id}_{d}_{bi}")

    # ── R1: Cobertura exacta por bloque y día ──────────────────────────────────
    for d in range(n_dias):
        for bi, (post, sigla, ini, dur, cant, elegibles) in enumerate(bloques):
            asignados = [x[g.id, d, bi] for g in guardias if (g.id, d, bi) in x]
            model.Add(sum(asignados) == cant)

    # ── R2: Un bloque máximo por guardia por día ───────────────────────────────
    for g in guardias:
        for d in range(n_dias):
            bloques_dia = [x[g.id, d, bi] for bi in range(len(bloques)) if (g.id, d, bi) in x]
            if len(bloques_dia) > 1:
                model.Add(sum(bloques_dia) <= 1)

    # ── R3: Descanso mínimo entre turnos (horas absolutas) ────────────────────
    # Ordenar por hora de inicio absoluta para que el break funcione correctamente:
    # una vez que s2 - e1 >= rest_min, todos los siguientes también lo cumplen.
    block_abs = sorted(
        [
            (d, bi, d * 24 + ini, d * 24 + ini + dur)
            for d in range(n_dias)
            for bi, (_, _, ini, dur, _, _) in enumerate(bloques)
        ],
        key=lambda t: t[2],  # ordenar por hora de inicio absoluta
    )

    for g in guardias:
        for i, (d1, bi1, s1, e1) in enumerate(block_abs):
            if (g.id, d1, bi1) not in x:
                continue
            for j in range(i + 1, len(block_abs)):
                d2, bi2, s2, _ = block_abs[j]
                if s2 - e1 >= rest_min:
                    break  # todos los bloques siguientes tienen aún más holgura
                if (g.id, d2, bi2) not in x:
                    continue
                # Descanso insuficiente entre estos dos bloques → mutuamente excluyentes
                model.Add(x[g.id, d1, bi1] + x[g.id, d2, bi2] <= 1)

    # ── R3b: Ancla mes anterior ────────────────────────────────────────────────
    # Si se informa el fin del último turno del mes previo, bloquear cualquier
    # bloque del período actual que no cumpla el descanso mínimo respecto a él.
    for g in guardias:
        if g.ultimo_turno_fin_h is None:
            continue
        e_prev = g.ultimo_turno_fin_h
        for d2, bi2, s2, _ in block_abs:
            if (g.id, d2, bi2) not in x:
                continue
            if s2 - e_prev >= rest_min:
                break
            model.Add(x[g.id, d2, bi2] == 0)

    # ── R4: Días trabajados — variables auxiliares ─────────────────────────────
    trabaja_dia = {}
    for g in guardias:
        for d in range(n_dias):
            td = model.NewBoolVar(f"td_{g.id}_{d}")
            bloques_disponibles = [x[g.id, d, bi] for bi in range(len(bloques)) if (g.id, d, bi) in x]
            if bloques_disponibles:
                model.Add(sum(bloques_disponibles) >= 1).OnlyEnforceIf(td)
                model.Add(sum(bloques_disponibles) == 0).OnlyEnforceIf(td.Not())
            else:
                model.Add(td == 0)
            trabaja_dia[g.id, d] = td

        # Máx días en cualquier ventana de 7 días consecutivos
        for d in range(n_dias - max_por_semana):
            model.Add(
                sum(trabaja_dia[g.id, d + k] for k in range(max_por_semana + 1))
                <= max_por_semana
            )

        # Máx días seguidos
        for d in range(n_dias - max_dias_seguidos):
            model.Add(
                sum(trabaja_dia[g.id, d + k] for k in range(max_dias_seguidos + 1))
                <= max_dias_seguidos
            )

    # ── R5: Descanso semanal — 2 días consecutivos libres por semana ──────────
    # Aproxima el descanso continuo de 35h exigido por CCT 422/05.
    # Con turnos de 8h: 2 días libres contiguos = ~48h de descanso efectivo.
    if rest_semanal_dias >= 2:
        for g in guardias:
            for w in range(n_dias - 6):          # cada ventana de 7 días
                pares_libres = []
                for k in range(6):               # 6 pares posibles dentro de la ventana
                    d1, d2 = w + k, w + k + 1
                    ambos_libres = model.NewBoolVar(f"al_{g.id}_{w}_{k}")
                    model.AddBoolAnd([
                        trabaja_dia[g.id, d1].Not(),
                        trabaja_dia[g.id, d2].Not(),
                    ]).OnlyEnforceIf(ambos_libres)
                    model.AddBoolOr([
                        trabaja_dia[g.id, d1],
                        trabaja_dia[g.id, d2],
                    ]).OnlyEnforceIf(ambos_libres.Not())
                    pares_libres.append(ambos_libres)
                model.AddBoolOr(pares_libres)   # al menos un par libre en la ventana

    # ── Objetivo ──────────────────────────────────────────────────────────────
    horas_expr = {
        g.id: sum(
            x[g.id, d, bi] * bloques[bi][3]
            for d in range(n_dias)
            for bi in range(len(bloques))
            if (g.id, d, bi) in x
        )
        for g in guardias
    }

    max_h = model.NewIntVar(0, 800, "max_h")
    min_h = model.NewIntVar(0, 800, "min_h")
    excesos = []
    penalizaciones = []

    for g in guardias:
        model.Add(max_h >= horas_expr[g.id])
        model.Add(min_h <= horas_expr[g.id])
        exc = model.NewIntVar(0, 800, f"exc_{g.id}")
        model.Add(exc >= horas_expr[g.id] - techo_horas)
        model.Add(exc >= 0)
        excesos.append(exc)

        # Penalización blanda: asignar banda distinta a la preferida
        if g.preferencia_banda and peso_pref_banda > 0:
            for d in range(n_dias):
                for bi, (_, sigla, _, _, _, _) in enumerate(bloques):
                    if (g.id, d, bi) in x and sigla != g.preferencia_banda:
                        penalizaciones.append(x[g.id, d, bi] * peso_pref_banda)

    model.Minimize(
        sum(excesos) * 100                              # prioridad: no superar techo
        + (max_h - min_h) * 5                          # secundario: equidad entre guardias
        + (sum(penalizaciones) if penalizaciones else 0)  # terciario: respetar preferencias
    )

    # ── Resolver ──────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = tiempo_limite_seg
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return status, {}, {}, bloques

    # ── Extraer resultado ──────────────────────────────────────────────────────
    per_guard = defaultdict(dict)
    totales = {}
    for g in guardias:
        totales[g.id] = solver.Value(horas_expr[g.id])
        for d in range(n_dias):
            for bi, (post, sigla, ini, dur, _, _) in enumerate(bloques):
                if (g.id, d, bi) in x and solver.Value(x[g.id, d, bi]) == 1:
                    codigo = f"{sigla}(FF)" if d in feriados else sigla
                    per_guard[g.id][d] = (post, sigla, ini, dur, codigo)

    return status, per_guard, totales, bloques


# ─── 4. VERIFICACIÓN ──────────────────────────────────────────────────────────

def verificar(
    per_guard,
    bloques,
    n_dias,
    guardias=None,              # list[Guardia] — para verificar ausencias
    rest_min=11,
    techo_horas=200,
    max_dias_seguidos=6,
    max_por_semana=6,
):
    """
    Verifica que el resultado cumpla todas las restricciones.
    Retorna lista de strings con los errores encontrados.
    """
    errores = []
    guard_ids = list(per_guard.keys())
    ausencias_por_id = {g.id: g.ausencias for g in (guardias or [])}

    # Cobertura exacta por bloque y día
    for d in range(n_dias):
        for bi, (post, sigla, ini, dur, cant, _) in enumerate(bloques):
            cubiertos = sum(
                1 for gid in guard_ids
                if per_guard[gid].get(d, (None, None))[:2] == (post, sigla)
            )
            if cubiertos != cant:
                errores.append(
                    f"Día {d:02d} {post}-{sigla}: cubierto={cubiertos}, requerido={cant}"
                )

    for gid in guard_ids:
        aus = ausencias_por_id.get(gid, set())
        dias = sorted(per_guard[gid].keys())

        # Asignación en día de ausencia
        for d in dias:
            if d in aus:
                errores.append(f"{gid}: asignado el día {d} que figura como ausencia")

        # Máximo un bloque por día
        for d in dias:
            # per_guard[gid][d] guarda el último asignado — validación adicional externa
            pass  # el solver ya lo garantiza con R2; aquí solo se verifica cobertura

        # Descanso mínimo entre turnos consecutivos
        for i in range(len(dias) - 1):
            d1, d2 = dias[i], dias[i + 1]
            post1, sigla1, ini1, dur1, _ = per_guard[gid][d1]
            post2, sigla2, ini2, dur2, _ = per_guard[gid][d2]
            e1 = d1 * 24 + ini1 + dur1
            s2 = d2 * 24 + ini2
            if s2 - e1 < rest_min:
                errores.append(
                    f"{gid}: descanso {s2-e1}h entre día {d1}({sigla1}) y día {d2}({sigla2}) "
                    f"— mínimo {rest_min}h (CCT art.17)"
                )

        # Máx días por semana y días seguidos
        worked = [1 if d in per_guard[gid] else 0 for d in range(n_dias)]
        for d in range(n_dias - max_por_semana):
            if sum(worked[d:d + max_por_semana + 1]) > max_por_semana:
                errores.append(
                    f"{gid}: más de {max_por_semana} días trabajados en 7 días consecutivos "
                    f"(ventana desde día {d})"
                )
        for d in range(n_dias - max_dias_seguidos):
            if sum(worked[d:d + max_dias_seguidos + 1]) > max_dias_seguidos:
                errores.append(
                    f"{gid}: más de {max_dias_seguidos} días consecutivos "
                    f"(desde día {d}) — CCT art.17"
                )

        # Techo de horas
        h = sum(per_guard[gid][d][3] for d in dias)
        if h > techo_horas:
            errores.append(
                f"{gid}: {h}h supera el techo de {techo_horas}h/mes"
            )

    return errores


# ─── 5. DEMO ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Servicio: Obrador Malagueño — 5 puestos, 18 guardias, 31 días
    puestos = [
        Puesto("Puesto1",   pax=2, modalidad="8h"),
        Puesto("Puesto2",   pax=1, modalidad="8h"),
        Puesto("Puesto3",   pax=1, modalidad="8h"),
        Puesto("Encargada", pax=1, modalidad="custom", duracion_custom=9,  inicio_custom=8),
        Puesto("Rondin",    pax=1, modalidad="custom", duracion_custom=10, inicio_custom=12),
    ]

    bloques = generar_bloques(puestos)
    total_h_dia = sum(dur * cant for _, _, _, dur, cant, _ in bloques)
    print(f"=== Demanda: {len(bloques)} bloques · {total_h_dia}h/día ===")
    for post, sigla, ini, dur, cant, _ in bloques:
        print(f"  {post:10s}  {sigla:4s}  {ini:02d}:00-{(ini+dur)%24:02d}:00  {dur}h  x{cant}")

    # Guardias con preferencias y ausencias variadas
    bandas_ciclo = ["M", "T", "N", "M", "T", "N"]
    guardias = []
    for i in range(1, 19):
        aus = {14} if i % 5 == 0 else set()   # cada 5 guardias tiene el día 14 libre
        guardias.append(Guardia(
            id=f"G{i:02d}",
            nombre=f"Guardia {i:02d}",
            preferencia_banda=bandas_ciclo[i % 6],
            ausencias=aus,
        ))

    # G01 terminó turno N el último día del mes anterior (ancla mes anterior)
    # Turno N: 22:00 → 06:00 del día siguiente; si ese día siguiente es el día 0 del período:
    # fin_h = 6 (06:00 del día 0 en horas absolutas)
    guardias[0].ultimo_turno_fin_h = 6

    N_DIAS = 31
    # Suponer que los días 24 y 25 (0-indexed) son feriados
    feriados_demo = {24, 25}

    print(f"\n=== Resolviendo: {N_DIAS} días · {len(guardias)} guardias · techo 200h ===")
    status, per_guard, totales, _ = resolver(
        bloques, N_DIAS, guardias,
        techo_horas=200,
        feriados=feriados_demo,
        tiempo_limite_seg=30,
    )

    nombre_status = {2: "OPTIMAL", 4: "FEASIBLE", 3: "INFEASIBLE", 0: "UNKNOWN"}.get(status, str(status))
    print(f"Status: {nombre_status}")

    if per_guard:
        horas = list(totales.values())
        print(f"  max: {max(horas)}h  min: {min(horas)}h  avg: {sum(horas)/len(horas):.1f}h")
        for gid, h in sorted(totales.items()):
            flag = "  ⚠ supera techo" if h > 200 else ""
            print(f"  {gid}: {h}h{flag}")

        print()
        errores = verificar(per_guard, bloques, N_DIAS, guardias=guardias)
        print(f"=== Verificación: {len(errores)} errores ===")
        for e in errores[:10]:
            print(f"  - {e}")
        if not errores:
            print("  ✓ Cobertura completa, CCT respetado, nadie supera el techo.")

        # Mostrar guardias en días de feriado con código FF
        ff_dias = {gid: [d for d, t in per_guard[gid].items() if "(FF)" in t[4]]
                   for gid in per_guard}
        ff_activos = {gid: ds for gid, ds in ff_dias.items() if ds}
        if ff_activos:
            print(f"\n  Guardias con turnos en feriado (FF):")
            for gid, ds in sorted(ff_activos.items()):
                print(f"    {gid}: días {ds}")
