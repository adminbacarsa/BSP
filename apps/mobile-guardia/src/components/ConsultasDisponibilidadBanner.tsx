import { View } from 'react-native';
import { ConvocatoriaCard } from './ConvocatoriaCard';
import { buildDisponibilidadCardModel } from '../lib/convocatoriaCard';
import type { ConsultaInvitacion } from '../hooks/useConsultasDisponibilidad';

export function ConsultasDisponibilidadBanner({
  items,
  busyId,
  nowMs,
  onSi,
  onNo,
}: {
  items: ConsultaInvitacion[];
  busyId: string | null;
  nowMs: number;
  onSi: (item: ConsultaInvitacion) => void;
  onNo: (item: ConsultaInvitacion) => void;
}) {
  if (!items.length) return null;
  return (
    <View>
      {items.map((item) => {
        const j = item.jornadas[0];
        const fecha = j?.fecha && j.fecha.length === 10 ? `${j.fecha.slice(8, 10)}/${j.fecha.slice(5, 7)}/${j.fecha.slice(0, 4)}` : null;
        const horario = j?.horaInicio && j?.horaFin ? `${String(j.horaInicio).slice(0, 5)}–${String(j.horaFin).slice(0, 5)}` : null;
        return (
          <ConvocatoriaCard
            key={item.id}
            model={buildDisponibilidadCardModel({
              id: item.id,
              message: item.texto,
              cliente: item.clientName,
              objetivo: item.objectiveName,
              puesto: item.positionName,
              fecha,
              horario,
              timeoutAtMs: item.venceAtMs,
            })}
            nowMs={nowMs}
            busy={busyId === item.id}
            disabled={!!busyId && busyId !== item.id}
            onAccept={() => onSi(item)}
            onReject={() => onNo(item)}
            testID={`consulta-${item.id}`}
          />
        );
      })}
    </View>
  );
}
