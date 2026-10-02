import { isActionableOpsVacancy, isVacancyDescubierto } from '@cosp/ops-core';
import type { OperacionesMarkerPreset } from '@/lib/operaciones/mapMarkerIcons';
import { buildEventoGroups, estadoGuardiaEvento, isEventShift, type EventoGrupo } from '@/lib/operaciones/eventoCc';

export type OperacionesMapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  client: string;
  shifts: any[];
  iconPreset: OperacionesMarkerPreset;
  statusText: string;
  hasShift: boolean;
  layerOrder: number;
  isEvent?: boolean;
  /** Evento: «Evento: {evento} · {servicio}» (el `name` es solo el nombre del evento para la etiqueta del pin). */
  subtitle?: string;
  /** Evento: lugar (objetivo del evento o dirección). */
  lugar?: string | null;
  /** Evento: resumen de guardias por estado. */
  eventoResumen?: { presentes: number; sinFichar: number; tarde: number; ausentes: number; vacantes: number; retenidos: number; plan: number };
};

/** Separa pines apilados en el mismo lat/lng (p. ej. varios objetivos sin geo real). */
export function applyCoordJitter(markers: OperacionesMapMarker[]): OperacionesMapMarker[] {
  const groups = new Map<string, OperacionesMapMarker[]>();
  for (const m of markers) {
    const key = `${m.lat.toFixed(5)}:${m.lng.toFixed(5)}`;
    const list = groups.get(key) || [];
    list.push(m);
    groups.set(key, list);
  }
  const out: OperacionesMapMarker[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const radius = 0.00035 * Math.min(list.length, 8);
    list.forEach((m, i) => {
      const angle = (2 * Math.PI * i) / list.length;
      out.push({
        ...m,
        lat: m.lat + radius * Math.cos(angle),
        lng: m.lng + radius * Math.sin(angle),
      });
    });
  }
  return out;
}

const toStart = (s: any, now: Date): Date =>
  s.shiftDateObj
    ? s.shiftDateObj.seconds
      ? new Date(s.shiftDateObj.seconds * 1000)
      : s.shiftDateObj
    : now;

/**
 * Pines de objetivo. Los turnos EV no cuentan acá: el evento tiene su propio pin
 * (`buildEventoMarkers`) y el objetivo de base del guardia no se etiqueta «Evento».
 */
export function buildObjectiveMarkers(allObjectives: any[] = [], filteredShifts: any[] = [], now: Date = new Date()): OperacionesMapMarker[] {
  const normId = (x: any) => String(x ?? '').trim();
  return allObjectives
    .filter(
      (obj: any) =>
        obj != null &&
        obj.lat != null &&
        obj.lng != null &&
        Number.isFinite(Number(obj.lat)) &&
        Number.isFinite(Number(obj.lng)),
    )
    .map((obj: any) => {
      const shiftsInObjective = filteredShifts
        .filter((s: any) => normId(s.objectiveId) === normId(obj.id))
        .filter((s: any) => !s.isPassiveRetStandby)
        .filter((s: any) => !isEventShift(s));

      let iconPreset: OperacionesMarkerPreset = 'GRAY';
      let statusText = 'S/A';
      let priority = 0;

      shiftsInObjective.forEach((s: any) => {
        const start = toStart(s, now);
        const diffMin = (now.getTime() - start.getTime()) / 60000;
        const isReportedOrReturned = s.isUnassigned && s.isReportedToPlanning;
        const isDescubierto = s.isUnassigned && (s.isDescubierto || isVacancyDescubierto(s, now));
        const isActionableVac = isActionableOpsVacancy(s, now);

        if (isActionableVac && priority < 5) {
          iconPreset = 'RED';
          statusText = 'VACANTE';
          priority = 5;
        } else if ((s.isAbsent || s.isPotentialAbsence) && priority < 5) {
          iconPreset = 'RED';
          statusText = 'AUSENCIA';
          priority = 5;
        } else if (isDescubierto && priority < 4.2) {
          iconPreset = 'GRAY';
          statusText = 'DESCUBIERTO';
          priority = 4.2;
        } else if (isReportedOrReturned && priority < 4) {
          // Tratamiento hecho — no pintar como vacante roja
          iconPreset = 'VIOLET';
          statusText = 'DEVUELTA A PLANIF.';
          priority = 4;
        } else if (s.isRetention && priority < 4) {
          iconPreset = 'ORANGE';
          statusText = 'RETENCIÓN';
          priority = 4;
        } else if (
          (s.isLateNotified || s.isLateUnnotified) &&
          !s.isPresent &&
          !s.isAbsent &&
          !s.isPotentialAbsence &&
          priority < 3
        ) {
          iconPreset = 'YELLOW';
          statusText = s.isLateNotified ? 'TARDE AVISADA' : 'TARDE';
          priority = 3;
        } else if (
          !s.isLateNotified &&
          !s.isLateUnnotified &&
          !s.isPresent &&
          !s.isAbsent &&
          !s.isPotentialAbsence &&
          !s.isCompleted &&
          !s.isFranco &&
          !s.isUnassigned &&
          diffMin > 5 &&
          priority < 3
        ) {
          iconPreset = 'YELLOW';
          statusText = 'TARDE';
          priority = 3;
        } else if ((s.isPresent || (diffMin >= -15 && diffMin <= 5 && !s.isPresent)) && priority < 2) {
          iconPreset = 'GREEN';
          statusText = s.isPresent ? 'ACTIVO' : 'A TIEMPO';
          priority = 2;
        } else if (s.isFranco && priority < 1) {
          iconPreset = 'BLUE';
          statusText = 'FRANCO';
          priority = 1;
        }
      });

      return {
        id: obj.id,
        lat: Number(obj.lat),
        lng: Number(obj.lng),
        name: obj.name,
        client: obj.clientName || 'Cliente',
        shifts: shiftsInObjective,
        iconPreset,
        statusText,
        hasShift: shiftsInObjective.length > 0,
        layerOrder: statusText === 'S/A' ? 0 : 1,
        isEvent: false,
      };
    });
}

export function eventoMarkerResumen(group: EventoGrupo<any>, now: Date): NonNullable<OperacionesMapMarker['eventoResumen']> {
  const r = { presentes: 0, sinFichar: 0, tarde: 0, ausentes: 0, vacantes: 0, retenidos: 0, plan: 0 };
  for (const s of group.shifts) {
    const { estado } = estadoGuardiaEvento(s, now);
    if (estado === 'PRESENTE' || estado === 'COMPLETADO') r.presentes++;
    else if (estado === 'SIN_FICHAR') r.sinFichar++;
    else if (estado === 'TARDE') r.tarde++;
    else if (estado === 'AUSENTE') r.ausentes++;
    else if (estado === 'VACANTE') r.vacantes++;
    else if (estado === 'RETENIDO') r.retenidos++;
    else r.plan++;
  }
  return r;
}

export function eventoMarkerStatus(r: NonNullable<OperacionesMapMarker['eventoResumen']>): { iconPreset: OperacionesMarkerPreset; statusText: string } {
  if (r.ausentes > 0 || r.vacantes > 0) {
    const partes = [r.ausentes > 0 ? `${r.ausentes} aus` : '', r.vacantes > 0 ? `${r.vacantes} vac` : ''].filter(Boolean).join(' · ');
    return { iconPreset: 'EVENT_ALERT', statusText: `EVENTO · ${partes}` };
  }
  if (r.tarde > 0) return { iconPreset: 'EVENT_LATE', statusText: `EVENTO · ${r.tarde} tarde` };
  if (r.presentes > 0) return { iconPreset: 'EVENT', statusText: `EVENTO · ${r.presentes} presente${r.presentes === 1 ? '' : 's'}` };
  if (r.sinFichar > 0) return { iconPreset: 'EVENT', statusText: `EVENTO · ${r.sinFichar} sin fichar` };
  return { iconPreset: 'EVENT', statusText: 'EVENTO · PLAN' };
}

/**
 * Un pin por evento · servicio en la ubicación del evento (`eventoLat`/`eventoLng`, resueltos por
 * el monitor desde el doc del evento o el objetivo del evento). Sin ubicación no hay pin: el
 * evento igual aparece en la lista del CC. Nunca se dibuja sobre el objetivo de base del guardia.
 */
export function buildEventoMarkers(filteredShifts: any[] = [], now: Date = new Date()): OperacionesMapMarker[] {
  return buildEventoGroups(filteredShifts.filter((s: any) => !s?.isPassiveRetStandby), now)
    .filter((g) => g.lat !== null && g.lng !== null)
    .map((g) => {
      const eventoResumen = eventoMarkerResumen(g, now);
      const { iconPreset, statusText } = eventoMarkerStatus(eventoResumen);
      return {
        id: g.eventKey,
        lat: g.lat as number,
        lng: g.lng as number,
        name: g.eventoNombre,
        client: g.client || 'Evento',
        shifts: g.shifts,
        iconPreset,
        statusText,
        hasShift: g.shifts.length > 0,
        layerOrder: 2,
        isEvent: true,
        subtitle: g.label,
        lugar: g.lugar,
        eventoResumen,
      };
    });
}

export function buildOperacionesMapMarkers(allObjectives: any[] = [], filteredShifts: any[] = [], now: Date = new Date()): OperacionesMapMarker[] {
  const built = [...buildObjectiveMarkers(allObjectives, filteredShifts, now), ...buildEventoMarkers(filteredShifts, now)]
    .sort((a, b) => (a.layerOrder || 0) - (b.layerOrder || 0));
  return applyCoordJitter(built);
}
