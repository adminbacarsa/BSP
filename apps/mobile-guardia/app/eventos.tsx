import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Evento, ServicioEvento, SolicitudEvento } from '@cosp/portal-types';
import {
  formatDateAr,
  horarioBadgeServicio,
  servicioUbicacionLabel,
  solicitudEventoStatusLabel,
} from '@cosp/portal-core';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEventosPortal } from '../src/hooks/useEventosPortal';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { PortalErrorPanel } from '../src/components/PortalErrorPanel';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

export default function EventosScreen() {
  return (
    <RequireAuth>
      <EventosScreenContent />
    </RequireAuth>
  );
}

function EventosScreenContent() {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { employee, empDocId, portalFeatures, user, isPreviewMode } = usePortalAuth();

  const displayName = useMemo(() => {
    if (employee?.lastName || employee?.firstName) {
      return `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'Vigilador';
  }, [employee, user]);

  const {
    solicitudes,
    disponibles,
    convocatoriasPendientes,
    loading,
    busyId,
    error,
    reload,
    solicitar,
    responderConvocatoria,
  } = useEventosPortal(employee?.empresaId, empDocId, displayName, {
    isPreviewMode,
  });

  const scrollBottomPad = Math.max(insets.bottom, 12) + 24;

  if (!portalFeatures.viewEvents) {
    return (
      <>
        <Stack.Screen options={{ title: 'Eventos' }} />
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
          <CommandCard>
            <Text style={{ color: palette.onSurfaceMuted }}>Los eventos no están habilitados para tu empresa.</Text>
          </CommandCard>
        </SafeAreaView>
      </>
    );
  }

  async function onSolicitar(evento: Evento, servicio: ServicioEvento) {
    const result = await solicitar(evento, servicio);
    Alert.alert(result.ok ? 'Enviada' : 'Error', result.message);
  }

  async function onResponder(sol: SolicitudEvento, acepta: boolean) {
    const result = await responderConvocatoria(sol, acepta);
    Alert.alert(result.ok ? 'Listo' : 'Error', result.message);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Eventos' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
            Servicios especiales (código EV). Podés solicitar cupos o responder convocatorias del administrador. Al
            aceptar, tu turno del día pasa a evento y planificación recibe la vacante generada.
            {isPreviewMode
              ? ' En PREVIEW, Acepto/No puedo usan el legajo elegido (asEmployeeId). Solicitar cupo está bloqueado.'
              : ''}
          </Text>

          {error ? (
            <PortalErrorPanel title="Eventos" message={error} onRetry={() => void reload()} />
          ) : null}

          {convocatoriasPendientes.length > 0 ? (
            <CommandCard title={`Convocatorias (${convocatoriasPendientes.length})`}>
              {convocatoriasPendientes.map((sol) => (
                <ConvocatoriaCard
                  key={sol.id}
                  sol={sol}
                  busy={busyId === sol.id}
                  onAccept={() => void onResponder(sol, true)}
                  onReject={() => void onResponder(sol, false)}
                />
              ))}
            </CommandCard>
          ) : null}

          <CommandCard title="Eventos disponibles">
            {loading ? (
              <ActivityIndicator color={palette.primary} />
            ) : disponibles.length === 0 ? (
              <Text style={{ color: palette.onSurfaceMuted, fontSize: 13 }}>
                No hay servicios abiertos en el mes. Cuando RRHH publique un evento, aparecerá acá.
              </Text>
            ) : (
              disponibles.map(({ evento, servicio }) => {
                const sol = solicitudes.find((s) => s.servicioId === servicio.id);
                return (
                  <ServicioRow
                    key={servicio.id}
                    evento={evento}
                    servicio={servicio}
                    solicitud={sol}
                    busy={busyId === servicio.id}
                    onSolicitar={() => void onSolicitar(evento, servicio)}
                  />
                );
              })
            )}
          </CommandCard>

          {solicitudes.length > 0 ? (
            <CommandCard title="Mis solicitudes">
              {solicitudes.map((sol) => (
                <View
                  key={sol.id}
                  style={[styles.reqRow, { borderColor: palette.cardBorder, backgroundColor: palette.inputBg }]}
                >
                  <Text style={{ color: palette.onSurface, fontWeight: '800' }}>{sol.eventoNombre}</Text>
                  <Text style={{ color: palette.onSurfaceMuted, fontSize: 12, marginTop: 2 }}>
                    {sol.servicioNombre} · {formatDateAr(`${sol.servicioFecha}T12:00:00`)}
                  </Text>
                  <Text style={{ color: palette.primary, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                    {solicitudEventoStatusLabel(sol.status)}
                  </Text>
                </View>
              ))}
            </CommandCard>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function ConvocatoriaCard({
  sol,
  busy,
  onAccept,
  onReject,
}: {
  sol: SolicitudEvento;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={[styles.convCard, { borderColor: palette.warning, backgroundColor: palette.card }]}>
      <Text style={{ color: palette.onSurface, fontWeight: '900' }}>{sol.eventoNombre}</Text>
      <Text style={{ color: palette.onSurfaceMuted, fontSize: 12, marginTop: 4 }}>
        {sol.servicioNombre} · {formatDateAr(`${sol.servicioFecha}T12:00:00`)}
      </Text>
      <View style={styles.rowBtns}>
        <CommandButton label="Acepto" variant="success" onPress={onAccept} disabled={busy} />
        <CommandButton label="No puedo" variant="secondary" onPress={onReject} disabled={busy} />
      </View>
    </View>
  );
}

function ServicioRow({
  evento,
  servicio,
  solicitud,
  busy,
  onSolicitar,
}: {
  evento: Evento;
  servicio: ServicioEvento;
  solicitud?: SolicitudEvento;
  busy: boolean;
  onSolicitar: () => void;
}) {
  const { palette } = useTheme();
  const lugar = servicioUbicacionLabel(servicio.ubicacion);
  return (
    <View style={[styles.servRow, { borderColor: palette.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.onSurface, fontWeight: '800' }}>{servicio.nombre}</Text>
        <Text style={{ color: palette.primary, fontSize: 12, marginTop: 2 }}>{evento.nombre}</Text>
        <Text style={{ color: palette.onSurfaceMuted, fontSize: 12, marginTop: 4 }}>
          {formatDateAr(`${servicio.fecha}T12:00:00`)} · {horarioBadgeServicio(servicio)}
        </Text>
        {lugar ? (
          <Text style={{ color: palette.onSurfaceMuted, fontSize: 11, marginTop: 2 }}>{lugar}</Text>
        ) : null}
        {servicio.requisitos ? (
          <Text style={{ color: palette.warning, fontSize: 11, marginTop: 4 }}>{servicio.requisitos}</Text>
        ) : null}
      </View>
      {solicitud ? (
        <Text style={{ color: palette.success, fontSize: 11, fontWeight: '800', maxWidth: 88, textAlign: 'right' }}>
          {solicitudEventoStatusLabel(solicitud.status)}
        </Text>
      ) : (
        <CommandButton label={busy ? '…' : 'Solicitar'} variant="secondary" onPress={onSolicitar} disabled={busy} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, gap: spacing.md },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  convCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  servRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  reqRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
