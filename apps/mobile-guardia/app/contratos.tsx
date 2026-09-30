import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  acuseRecibido,
  clasificarContratoEventual,
  contratoEstadoLabel,
  formatBrutoArs,
  horasContrato,
  periodoContratoLabel,
  puedeAcusarRecibo,
  type ContratoEventualPortal,
} from '@cosp/portal-core';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useContratosEventuales } from '../src/hooks/useContratosEventuales';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { acusarReciboContrato } from '../src/lib/acusarReciboContrato';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';
import { appAlert } from '@/lib/appAlert';

export default function ContratosScreen() {
  return (
    <RequireAuth>
      <ContratosScreenContent />
    </RequireAuth>
  );
}

function ContratosScreenContent() {
  const { isEventual, eventualLegajos, empresasNombres, employee } = usePortalAuth();
  const { palette } = useTheme();
  const router = useRouter();
  const { vigentes, pasados, loading, error, hoyKey } = useContratosEventuales(eventualLegajos);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acusadosLocal, setAcusadosLocal] = useState<Set<string>>(new Set());

  const onAcusar = useCallback(
    (c: ContratoEventualPortal) => {
      appAlert(
        'Recibí el contrato',
        `Vas a confirmar que recibiste el contrato de ${empresasNombres[c.empresaId || ''] || c.empresaId || 'la empresa'} (${periodoContratoLabel(c)}). Queda registrado con fecha y hora.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Confirmar',
            onPress: () => {
              void (async () => {
                setBusyId(c.id);
                try {
                  const res = await acusarReciboContrato(c.id, employee?.deviceId ?? null);
                  if (res.ok) {
                    setAcusadosLocal((prev) => new Set(prev).add(c.id));
                  }
                  appAlert(res.ok ? 'Acuse registrado' : 'Acuse de recibo', res.message);
                } finally {
                  setBusyId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [empresasNombres, employee?.deviceId],
  );

  const renderContrato = (c: ContratoEventualPortal) => {
    const bucket = clasificarContratoEventual(c, hoyKey);
    const empresa = empresasNombres[c.empresaId || ''] || c.empresaId || 'Empresa';
    const jornadas = c.jornadas?.length || 0;
    const horas = horasContrato(c);
    const bruto = formatBrutoArs(c.brutoEstimado);
    const yaAcusado = acuseRecibido(c) || acusadosLocal.has(c.id);
    const puedeAcusar = !yaAcusado && puedeAcusarRecibo(c, hoyKey);
    const accent = bucket === 'VIGENTE' ? palette.success : bucket === 'BORRADOR' ? palette.warning : '#64748b';

    return (
      <View
        key={c.id}
        style={[
          styles.row,
          { backgroundColor: palette.card, borderColor: palette.cardBorder, opacity: bucket === 'PASADO' ? 0.9 : 1 },
        ]}
      >
        <View style={[styles.rowAccent, { backgroundColor: accent }]} />
        <View style={styles.rowBody}>
          <View style={styles.rowHead}>
            <Text style={[styles.empresa, { color: palette.onSurface }]} numberOfLines={1}>
              {empresa}
            </Text>
            <View style={[styles.badge, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
              <Text style={[styles.badgeText, { color: accent }]}>{contratoEstadoLabel(c.estado)}</Text>
            </View>
          </View>
          <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>Período {periodoContratoLabel(c)}</Text>
          <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>
            {jornadas} jornada{jornadas === 1 ? '' : 's'}
            {horas > 0 ? ` · ${horas} h` : ''}
            {c.causa ? ` · ${c.causa}` : ''}
          </Text>
          {bruto ? (
            <Text style={[styles.line, { color: palette.onSurface, fontWeight: '800' }]}>Bruto estimado {bruto}</Text>
          ) : null}
          {c.jornadas && c.jornadas.length > 0 ? (
            <View style={styles.jornadas}>
              {c.jornadas.slice(0, 8).map((j, idx) => (
                <Text key={`${c.id}_${j.fecha}_${idx}`} style={[styles.jornada, { color: palette.onSurfaceMuted }]}>
                  {fmtFecha(j.fecha)}
                  {j.horaInicio && j.horaFin ? ` ${j.horaInicio}–${j.horaFin}` : ''}
                  {j.horas ? ` (${j.horas} h)` : ''}
                </Text>
              ))}
              {c.jornadas.length > 8 ? (
                <Text style={[styles.jornada, { color: palette.onSurfaceMuted }]}>+{c.jornadas.length - 8} más</Text>
              ) : null}
            </View>
          ) : null}
          {yaAcusado ? (
            <Text style={[styles.acuseOk, { color: palette.success }]}>Recibido ✓</Text>
          ) : puedeAcusar ? (
            <CommandButton
              label={busyId === c.id ? 'Registrando…' : 'Recibí el contrato'}
              variant="success"
              loading={busyId === c.id}
              disabled={busyId === c.id}
              onPress={() => onAcusar(c)}
              style={styles.acuseBtn}
            />
          ) : null}
          {bucket === 'VIGENTE' ? (
            <CommandButton
              label="Confirmar anexo"
              variant="secondary"
              onPress={() => router.push({ pathname: '/codigo-anexo', params: { contratoId: c.id } })}
              style={styles.acuseBtn}
            />
          ) : null}
        </View>
      </View>
    );
  };

  if (!isEventual) {
    return (
      <>
        <Stack.Screen options={{ title: 'Mis contratos' }} />
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
          <View style={styles.scroll}>
            <Text style={{ color: palette.onSurfaceMuted }}>
              Esta sección es para vigiladores eventuales de la bolsa.
            </Text>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Mis contratos' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
            Contratos eventuales por empresa. Confirmá que recibiste cada contrato con «Recibí el contrato».
          </Text>
          {error ? <Text style={[styles.error, { color: palette.error }]}>{error}</Text> : null}
          {loading && vigentes.length === 0 && pasados.length === 0 ? (
            <ActivityIndicator color={palette.primary} size="large" />
          ) : null}

          <CommandCard title={`Vigentes (${vigentes.length})`}>
            {vigentes.length === 0 && !loading ? (
              <Text style={{ color: palette.onSurfaceMuted }}>No tenés contratos vigentes.</Text>
            ) : (
              vigentes.map(renderContrato)
            )}
          </CommandCard>

          <CommandCard title={`Pasados (${pasados.length})`}>
            {pasados.length === 0 && !loading ? (
              <Text style={{ color: palette.onSurfaceMuted }}>Sin contratos anteriores.</Text>
            ) : (
              pasados.map(renderContrato)
            )}
          </CommandCard>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function fmtFecha(key: string | undefined): string {
  const k = String(key || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  return m ? `${m[3]}/${m[2]}` : k || '—';
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, gap: spacing.md, paddingBottom: 32 },
  intro: { fontSize: 13, lineHeight: 19 },
  error: { fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 10,
  },
  rowAccent: { width: 4 },
  rowBody: { flex: 1, padding: 12, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  empresa: { fontWeight: '800', fontSize: 15, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  line: { fontSize: 13, fontWeight: '600' },
  jornadas: { marginTop: 4, gap: 1 },
  jornada: { fontSize: 12 },
  acuseOk: { fontSize: 13, fontWeight: '800', marginTop: 6 },
  acuseBtn: { marginTop: 8 },
});
