import { View } from 'react-native';
import { ConvocatoriaCard } from './ConvocatoriaCard';
import { armarPreguntaDisponibilidad, buildDisponibilidadCardModel } from '../lib/convocatoriaCard';
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
        const bloque = armarPreguntaDisponibilidad({
          cliente: item.clientName,
          objetivo: item.objectiveName,
          puesto: item.positionName,
          jornadas: item.jornadas,
          now: new Date(nowMs),
        });
        const j = item.jornadas[0];
        const fecha = !bloque && j?.fecha && j.fecha.length === 10 ? `${j.fecha.slice(8, 10)}/${j.fecha.slice(5, 7)}/${j.fecha.slice(0, 4)}` : null;
        const horario = !bloque && j?.horaInicio && j?.horaFin ? `${String(j.horaInicio).slice(0, 5)}–${String(j.horaFin).slice(0, 5)}` : null;
        return (
          <ConvocatoriaCard
            key={item.id}
            model={buildDisponibilidadCardModel({
              id: item.id,
              title: bloque ? '¿Podés cubrir?' : undefined,
              message: bloque ? `${bloque.pregunta}${bloque.contratos ? ` ${bloque.contratos}` : ''}` : item.texto,
              detalle: bloque?.detalle,
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
