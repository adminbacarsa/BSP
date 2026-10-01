import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

/**
 * Pantallas de ficha de Play con datos ficticios. No está en el menú.
 * /play-capturas/hoy | fichada | alertas | credencial | agenda | contratos
 */
export function generateStaticParams(): { frame: Frame }[] {
  return FRAMES.map((frame) => ({ frame }));
}
type Frame = 'hoy' | 'fichada' | 'alertas' | 'credencial' | 'agenda' | 'contratos';

const FRAMES: Frame[] = ['hoy', 'fichada', 'alertas', 'credencial', 'agenda', 'contratos'];

const C = {
  bg: '#fff5f5',
  header: '#8B1A1A',
  primary: '#D32F2F',
  card: '#ffffff',
  text: '#1e293b',
  muted: '#64748b',
  line: '#fecaca',
  ok: '#059669',
  okBg: '#d1fae5',
};

function frameOf(raw: string | string[] | undefined): Frame {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FRAMES.includes(value as Frame) ? (value as Frame) : 'hoy';
}

function Header({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function TabBar({ active }: { active: string }) {
  const tabs = ['Hoy', 'Agenda', 'Alertas', 'Más'];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => (
        <Text key={tab} style={[styles.tab, tab === active && styles.tabOn]}>
          {tab}
        </Text>
      ))}
    </View>
  );
}

function Hoy({ fichado }: { fichado?: boolean }) {
  return (
    <View style={styles.body}>
      <Text style={styles.kicker}>Portal del vigilador</Text>
      <Text style={styles.name}>Review Play</Text>
      <Text style={styles.meta}>Legajo PLAY-01</Text>
      <View style={styles.card}>
        <Text style={styles.kicker}>Turno de hoy</Text>
        <Text style={styles.shift}>Mañana · 07:00 a 15:00</Text>
        <Text style={styles.meta}>Cliente Revisión Play</Text>
        <Text style={styles.meta}>Objetivo Revisión Play · Puesto Revisión</Text>
        {fichado ? (
          <View style={styles.okBox}>
            <Text style={styles.okText}>Presente registrado · 07:12</Text>
          </View>
        ) : (
          <View style={styles.btn}>
            <Text style={styles.btnText}>Fichar presente</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Alertas() {
  return (
    <View style={styles.body}>
      <Text style={styles.kicker}>Bandeja</Text>
      <Text style={styles.name}>Alertas</Text>
      <View style={styles.card}>
        <Text style={styles.badge}>Cobertura</Text>
        <Text style={styles.shift}>Convocatoria de cobertura</Text>
        <Text style={styles.meta}>Objetivo Revisión Play · turno tarde</Text>
        <Text style={styles.meta}>¿Podés cubrir desde las 15:00?</Text>
        <View style={styles.row}>
          <View style={styles.btn}>
            <Text style={styles.btnText}>Acepto</Text>
          </View>
          <View style={styles.btnGhost}>
            <Text style={styles.btnGhostText}>No puedo</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function Credencial() {
  return (
    <View style={styles.body}>
      <Text style={styles.kicker}>Empresa de prueba</Text>
      <Text style={styles.name}>Credencial</Text>
      <View style={[styles.card, styles.center]}>
        <View style={styles.qr}>
          <QRCode value="COSP-PLAY-REVIEW-DEMO" size={148} />
        </View>
        <Text style={styles.shift}>Review Play</Text>
        <Text style={styles.meta}>DNI 00.000.000</Text>
        <Text style={styles.meta}>Legajo PLAY-01 · Vigilador</Text>
      </View>
    </View>
  );
}

function Agenda() {
  const marks = new Set([1, 2, 3, 6, 7, 8, 9, 10]);
  return (
    <View style={styles.body}>
      <Text style={styles.kicker}>Octubre 2026</Text>
      <Text style={styles.name}>Agenda</Text>
      <View style={styles.card}>
        <View style={styles.grid}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
            <View key={day} style={[styles.day, marks.has(day) && styles.dayOn]}>
              <Text style={[styles.dayNum, marks.has(day) && styles.dayNumOn]}>{day}</Text>
              {marks.has(day) ? <Text style={styles.dayCode}>M</Text> : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Contratos() {
  return (
    <View style={styles.body}>
      <Text style={styles.kicker}>Empresa de prueba</Text>
      <Text style={styles.name}>Mis contratos</Text>
      <View style={styles.card}>
        <Text style={styles.badge}>Vigente</Text>
        <Text style={styles.shift}>Contrato marco de prueba</Text>
        <Text style={styles.meta}>01/10/2026 al 31/10/2026</Text>
        <Text style={styles.meta}>Jornada mañana · datos de demostración</Text>
        <View style={styles.btn}>
          <Text style={styles.btnText}>Acusar recibo</Text>
        </View>
      </View>
    </View>
  );
}

export default function PlayCapturasScreen() {
  const params = useLocalSearchParams<{ frame?: string }>();
  const frame = frameOf(params.frame);
  const tab = frame === 'agenda' ? 'Agenda' : frame === 'alertas' ? 'Alertas' : frame === 'credencial' || frame === 'contratos' ? 'Más' : 'Hoy';
  const title =
    frame === 'credencial' ? 'Credencial' : frame === 'contratos' ? 'Mis contratos' : frame === 'alertas' ? 'Alertas' : frame === 'agenda' ? 'Agenda' : 'Hoy';

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title={title} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {frame === 'hoy' ? <Hoy /> : null}
        {frame === 'fichada' ? <Hoy fichado /> : null}
        {frame === 'alertas' ? <Alertas /> : null}
        {frame === 'credencial' ? <Credencial /> : null}
        {frame === 'agenda' ? <Agenda /> : null}
        {frame === 'contratos' ? <Contratos /> : null}
      </ScrollView>
      <TabBar active={tab} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.header, paddingTop: 18, paddingBottom: 14, paddingHorizontal: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  scroll: { paddingBottom: 12 },
  body: { padding: 16, gap: 6 },
  kicker: { color: C.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  name: { color: C.text, fontSize: 26, fontWeight: '800' },
  meta: { color: C.muted, fontSize: 14, marginTop: 2 },
  shift: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  card: {
    marginTop: 12,
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    gap: 4,
    shadowColor: '#7f1d1d',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  btn: {
    marginTop: 12,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnGhost: {
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
  },
  btnGhostText: { color: C.primary, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8 },
  okBox: { marginTop: 12, backgroundColor: C.okBg, borderRadius: 16, padding: 12 },
  okText: { color: C.ok, fontWeight: '800', textAlign: 'center' },
  badge: { color: C.primary, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  center: { alignItems: 'center' },
  qr: { backgroundColor: '#fff', padding: 8, borderRadius: 16, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: {
    width: 40,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff5f5',
  },
  dayOn: { backgroundColor: '#fee2e2' },
  dayNum: { color: C.text, fontWeight: '700', fontSize: 12 },
  dayNumOn: { color: C.primary },
  dayCode: { color: C.primary, fontSize: 10, fontWeight: '800' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: '#fff',
    paddingVertical: 12,
  },
  tab: { flex: 1, textAlign: 'center', color: C.muted, fontWeight: '700', fontSize: 12 },
  tabOn: { color: C.primary },
});
