import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { Timestamp, collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { MovilMenuScreens } from '@/components/movil/MovilMenuScreens';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useCronogramaSinPublicar } from '@/hooks/useCronogramaSinPublicar';
import { auth, db } from '@/lib/firebase';
import { menuMovil, modulosMovil } from '@/lib/movil/movilModulos';
import type { MovilAlerta } from '@/lib/movil/modulos';
import { MENU_TURNOS_ADELANTE_MS, MENU_TURNOS_ATRAS_MS, resumenTurnosMenu, type MenuDatos, type TurnoMenuLike } from '@/lib/movil/menuLayout';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';
import { novedadYaResuelta } from '@/lib/operaciones/novedadAlertDisplay';
import { belongsToEmpresaView, shouldScopeQueriesToEmpresa } from '@/lib/tenantScope';
import { useAusenciasPorRevisar } from '@/hooks/useAusenciasPorRevisar';

const ALERTAS_VENTANA_MS = 24 * 60 * 60 * 1000;

function toMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Selector de módulos (`/admin/movil/`).
 * `entrada`: se usa al entrar al panel; con un solo módulo permitido se entra directo sin pasar por el menú.
 * La línea de estado de cada tile usa datos reales: novedades pendientes de 24 h, turnos de hoy/mañana
 * (activos, ausencias, huecos) y CRONOGRAMA_SIN_PUBLICAR pendientes.
 */
export function MovilMenuModulos({ entrada = false }: { entrada?: boolean }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const { count: ausenciasPorRevisar } = useAusenciasPorRevisar(canReadModule('RRHH') ? empresaId : null);
  const empresaSheet = useEmpresaSheet();
  const modulos = modulosMovil(canReadModule, isSuperAdmin);
  const { unico } = menuMovil(modulos);
  const [novedades, setNovedades] = useState<Array<MovilAlerta & { status?: unknown }>>([]);
  const [turnos, setTurnos] = useState<TurnoMenuLike[] | null>(null);
  const saltar = entrada && Boolean(unico);
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const cronograma = useCronogramaSinPublicar(empresaId, !saltar && modulos.some((m) => m.id === 'planificacion'));

  useEffect(() => {
    if (entrada && unico) void router.replace(unico.href);
  }, [entrada, unico, router]);

  useEffect(() => {
    if (!empresaId || saltar) return;
    const since = new Date(Date.now() - ALERTAS_VENTANA_MS);
    const q = query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setNovedades(snap.docs.map((d) => d.data() as MovilAlerta & { status?: unknown })),
      () => setNovedades([]),
    );
    return () => unsub();
  }, [empresaId, saltar]);

  useEffect(() => {
    if (!empresaId || saltar) return;
    const now = Date.now();
    const scope = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
    const desde = Timestamp.fromMillis(now - MENU_TURNOS_ATRAS_MS);
    const hasta = Timestamp.fromMillis(now + MENU_TURNOS_ADELANTE_MS);
    const col = collection(db, 'turnos');
    const q = scope && empresaId.toLowerCase() !== 'bacarsa'
      ? query(col, where('empresaId', '==', empresaId), where('startTime', '>=', desde), where('startTime', '<=', hasta))
      : query(col, where('startTime', '>=', desde), where('startTime', '<=', hasta));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: TurnoMenuLike[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
          rows.push({
            startTime: toMs(data.startTime),
            isPresent: data.isPresent === true,
            isAbsent: data.isAbsent === true,
            isCompleted: data.isCompleted === true,
            realEndTime: data.realEndTime ?? null,
            employeeId: typeof data.employeeId === 'string' ? data.employeeId : null,
            isUnassigned: data.isUnassigned === true,
            draft: data.draft === true,
            isFranco: data.isFranco === true,
            isVirtual: data.isVirtual === true,
          });
        });
        setTurnos(rows);
      },
      () => setTurnos(null),
    );
    return () => unsub();
  }, [empresaId, saltar, migracionCompleta]);

  const alertas = useMemo(() => {
    const pendientes = novedades.filter((n) => !novedadYaResuelta(n));
    const out: Record<string, number> = {};
    for (const modulo of modulos) out[modulo.id] = pendientes.filter((n) => modulo.esAlertaDelModulo(n)).length;
    return out;
  }, [novedades, modulos]);

  const datos = useMemo(() => {
    const out: Record<string, MenuDatos> = {};
    const resumen = turnos ? resumenTurnosMenu(turnos, Date.now()) : null;
    const arca = novedades.filter((n) => !novedadYaResuelta(n) && String(n.type || '').toUpperCase().startsWith('ARCA_')).length;
    const sinCronograma = cronograma.gruposPlanificacion.reduce((acc, g) => acc + g.items.length, 0);
    if (resumen) {
      out.operacion = { activos: resumen.activos };
      out.supervision = { activos: resumen.activos };
      out.rrhh = { ausentesHoy: resumen.ausentesHoy, porRevisar: ausenciasPorRevisar };
      out.planificacion = { huecos: resumen.huecos, sinCronograma };
    } else if (sinCronograma > 0) {
      out.planificacion = { sinCronograma };
    }
    out.eventuales = { arcaPendientes: arca };
    if (ausenciasPorRevisar > 0) {
      out.rrhh = { ...(out.rrhh || {}), porRevisar: ausenciasPorRevisar, ausentesHoy: out.rrhh?.ausentesHoy };
    }
    return out;
  }, [turnos, novedades, cronograma.gruposPlanificacion, ausenciasPorRevisar]);

  if (entrada && unico) return <div className="min-h-screen bg-[#f7f8fa]" />;
  return (
    <>
      <MovilMenuScreens
        empresaName={empresaSheet.empresaName}
        modulos={modulos}
        unico={unico}
        alertas={alertas}
        datos={datos}
        onEmpresa={empresaSheet.onEmpresa}
        onModulo={(modulo) => { void router.push(modulo.href); }}
        onAsistente={() => window.dispatchEvent(new Event('cosp-assistant-open'))}
        onEscritorio={() => { writeMovilChoice('0'); void router.push('/admin/'); }}
        onLogout={() => {
          void signOut(auth).then(() => { window.location.href = '/login'; }).catch((error) => console.error(error));
        }}
      />
      {empresaSheet.sheet}
    </>
  );
}
