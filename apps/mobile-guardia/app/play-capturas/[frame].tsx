import type { ComponentType, ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { resolveCheckInUiStatus, type CheckInUiStatusView } from '@cosp/portal-core';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { HeroShiftPanel, formatHeroTimeRange } from '../../src/components/ui/HeroShiftPanel';
import { CheckInStatusBanner } from '../../src/components/ui/CheckInStatusBanner';
import { CoberturaConvocatoriasBanner } from '../../src/components/CoberturaConvocatoriasBanner';
import { LlegadaTardeVenisBanner } from '../../src/components/LlegadaTardeVenisBanner';
import { AgendaViewSwitcher } from '../../src/components/agenda/AgendaViewSwitcher';
import { AgendaMonthGrid } from '../../src/components/agenda/AgendaMonthGrid';
import { AgendaPeriodNav, AgendaShiftCard } from '../../src/components/agenda/AgendaShiftCard';
import { buildMonthCells, formatDayTitle, formatMonthTitle, groupShiftsByDateKey, toDateKey } from '../../src/lib/agendaCalendar';
import { resolveShiftPlacement } from '../../src/lib/shiftPlacement';
import type { ConvocatoriaCobertura } from '../../src/lib/convocatoriasCobertura';
import { radius, spacing } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';

/**
 * Pantallas de la ficha de Play con los componentes reales de la app y datos ficticios
 * (legajo PLAY-01, Cliente/Objetivo Revisión Play). No está en el menú ni usa Firestore.
 * /play-capturas/hoy | agenda | fichada | alertas | convocatoria | venis | credencial | contratos
 */
export function generateStaticParams(): { frame: Frame }[] {
  return FRAMES.map((frame) => ({ frame }));
}

type Frame = 'hoy' | 'agenda' | 'fichada' | 'alertas' | 'convocatoria' | 'venis' | 'credencial' | 'contratos';

const FRAMES: Frame[] = ['hoy', 'agenda', 'fichada', 'alertas', 'convocatoria', 'venis', 'credencial', 'contratos'];

/** Día fijo para que la captura sea reproducible (viernes 02/10/2026, hora AR). */
const TODAY = new Date('2026-10-02T06:40:00-03:00');
const EMPRESA = 'Empresa de prueba';
const GUARDIA = 'Review Play';
const LEGAJO = 'PLAY-01';
const CLIENTE = 'Cliente Revisión Play';
const OBJETIVO = 'Objetivo Revisión Play';
const PUESTO = 'Puesto Revisión';
const OBJETIVO_ID = 'obj_play_review';

const OBJECTIVES_MAP: Record<string, ObjectiveLocation> = {
  [OBJETIVO_ID]: {
    lat: -31.4201,
    lng: -64.1888,
    name: OBJETIVO,
    clientName: CLIENTE,
    address: 'Av. Ejemplo 1234, Córdoba',
    allowRemoteCheckIn: true,
  },
};

function at(day: number, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `2026-10-${dd}T${hh}:${mm}:00-03:00`;
}

function shift(day: number, code: 'M' | 'T' | 'N', extra: Partial<Shift> = {}): Shift {
  const [h0, h1] = code === 'M' ? [7, 15] : code === 'T' ? [15, 23] : [23, 7];
  return {
    id: `play-${day}-${code}`,
    employeeId: LEGAJO,
    objectiveId: OBJETIVO_ID,
    objectiveName: OBJETIVO,
    clientName: CLIENTE,
    positionName: PUESTO,
    code,
    startTime: at(day, h0),
    endTime: code === 'N' ? at(day + 1, h1) : at(day, h1),
    ...extra,
  } as Shift;
}

function franco(day: number): Shift {
  return {
    id: `play-${day}-F`,
    employeeId: LEGAJO,
    code: 'F',
    isFranco: true,
    startTime: at(day, 0),
    endTime: at(day, 23, 59),
  } as Shift;
}

/** Malla CCT 6+2 de octubre: 1–6 M, 7–8 F, 9–14 T, 15–16 F, 17–22 N, 23–24 F, 25–30 M, 31 F. */
function buildOctubre(): Shift[] {
  const out: Shift[] = [];
  const bloques: Array<[number, number, 'M' | 'T' | 'N' | 'F']> = [
    [1, 6, 'M'],
    [7, 8, 'F'],
    [9, 14, 'T'],
    [15, 16, 'F'],
    [17, 22, 'N'],
    [23, 24, 'F'],
    [25, 30, 'M'],
    [31, 31, 'F'],
  ];
  for (const [desde, hasta, code] of bloques) {
    for (let d = desde; d <= hasta; d++) {
      out.push(code === 'F' ? franco(d) : shift(d, code));
    }
  }
  return out;
}

const HOY = shift(2, 'M');
const HOY_PRESENTE = shift(2, 'M', {
  isPresent: true,
  status: 'PRESENT',
  checkInAt: at(2, 6, 57),
  realStartTime: at(2, 7, 0),
});

const CONVOCATORIA_COBERTURA: ConvocatoriaCobertura = {
  id: 'conv-play-ret',
  type: 'RET',
  status: 'PENDING',
  objectiveId: OBJETIVO_ID,
  objectiveName: OBJETIVO,
  clientName: CLIENTE,
  positionName: 'Puesto 2',
  shiftCode: 'T',
  startTime: at(2, 15),
  endTime: at(2, 23),
  timeoutAt: new Date(Date.now() + 14 * 60_000 + 32_000),
  cascadeStep: 1,
};

const CONVOCATORIA_VENIS: ConvocatoriaCobertura = {
  id: 'conv-play-venis',
  type: 'LLEGADA_TARDE',
  status: 'PENDING',
  shiftId: HOY.id,
  objectiveId: OBJETIVO_ID,
  objectiveName: OBJETIVO,
  positionName: PUESTO,
  startTime: at(2, 7),
};

function frameOf(raw: string | string[] | undefined): Frame {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FRAMES.includes(value as Frame) ? (value as Frame) : 'hoy';
}

/**
 * Íconos Ionicons como glifo directo: el HTML estático no corre expo-font, así que el
 * componente <Ionicons> quedaría vacío. Mismo .ttf que usa la app (hash de contenido del export).
 */
const IONICONS_FONT_URL =
  '/app/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.b4eb097d35f44ed943676fd56f6bdc51.ttf';
const GLYPH = {
  home: '\uf382',
  calendar: '\uf1cf',
  notifications: '\uf475',
  grid: '\uf355',
  location: '\uf3c4',
  'location-outline': '\uf3c5',
} as const;
type GlyphName = keyof typeof GLYPH;

function IconFontStyle() {
  if (Platform.OS !== 'web') return null;
  const css = `@font-face{font-family:'ionicons';src:url('${IONICONS_FONT_URL}') format('truetype');font-display:block;}`;
  const StyleTag = 'style' as unknown as ComponentType<Record<string, unknown>>;
  return <StyleTag dangerouslySetInnerHTML={{ __html: css }} />;
}

function Icon({ name, size, color }: { name: GlyphName; size: number; color: string }) {
  return (
    <Text style={{ fontFamily: 'ionicons', fontSize: size, lineHeight: size, color }} selectable={false}>
      {GLYPH[name]}
    </Text>
  );
}

function Header({ title }: { title: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: palette.header }]}>
      <Text style={[styles.headerTitle, { color: palette.headerTint }]}>{title}</Text>
    </View>
  );
}

type TabKey = 'Hoy' | 'Agenda' | 'Alertas' | 'Más';
const TABS: Array<{ key: TabKey; icon: 'home' | 'calendar' | 'notifications' | 'grid' }> = [
  { key: 'Hoy', icon: 'home' },
  { key: 'Agenda', icon: 'calendar' },
  { key: 'Alertas', icon: 'notifications' },
  { key: 'Más', icon: 'grid' },
];

function TabBar({ active, badge }: { active: TabKey; badge?: number }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.tabBar, { backgroundColor: palette.card, borderTopColor: palette.cardBorder }]}>
      {TABS.map((tab) => {
        const on = tab.key === active;
        const color = on ? palette.primary : palette.onSurfaceMuted;
        return (
          <View key={tab.key} style={styles.tabItem}>
            <View>
              <Icon name={tab.icon} size={24} color={color} />
              {tab.key === 'Alertas' && badge ? (
                <View style={[styles.tabBadge, { backgroundColor: palette.error }]}>
                  <Text style={styles.tabBadgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabLabel, { color }]}>{tab.key}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Welcome() {
  const { palette } = useTheme();
  return (
    <View style={styles.welcome}>
      <Text style={[styles.welcomeLabel, { color: palette.primary }]}>Portal del vigilador</Text>
      <Text style={[styles.welcomeName, { color: palette.onSurface }]}>{GUARDIA}</Text>
      <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>Legajo {LEGAJO}</Text>
    </View>
  );
}

function AlertChip({ count }: { count: number }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.alertChip, { backgroundColor: palette.warningContainer, borderColor: palette.warning }]}>
      <Text style={[styles.alertChipText, { color: palette.warning }]}>
        {count} alerta{count === 1 ? '' : 's'} sin leer · ver bandeja
      </Text>
    </View>
  );
}

function QuickRow() {
  const { palette } = useTheme();
  return (
    <View style={styles.quickRow}>
      <CommandCard style={styles.quickHalf}>
        <Text style={[styles.quickTitle, { color: palette.onSurface }]}>Eventos</Text>
        <Text style={[styles.quickSub, { color: palette.onSurfaceMuted }]}>Servicios EV</Text>
        <CommandButton label="Abrir" variant="secondary" onPress={() => {}} />
      </CommandCard>
      <CommandCard style={styles.quickHalf}>
        <Text style={[styles.quickTitle, { color: palette.onSurface }]}>Credencial</Text>
        <Text style={[styles.quickSub, { color: palette.onSurfaceMuted }]}>QR y verificación</Text>
        <CommandButton label="Abrir" variant="secondary" onPress={() => {}} />
      </CommandCard>
    </View>
  );
}

function HeroHoy({
  shiftDoc,
  view,
  extraStatus,
  footer,
}: {
  shiftDoc: Shift;
  view: CheckInUiStatusView;
  extraStatus?: ReactNode;
  footer: ReactNode;
}) {
  const placement = resolveShiftPlacement(shiftDoc, OBJECTIVES_MAP);
  return (
    <HeroShiftPanel
      headline="HOY"
      subline={formatHeroTimeRange(shiftDoc)}
      shift={shiftDoc}
      placement={placement}
      sectionLabel={view.status === 'present' ? 'Turno actual' : 'Próximo turno'}
      statusSlot={
        <>
          <CheckInStatusBanner view={view} onHero />
          {extraStatus}
        </>
      }
      footer={footer ? <View style={styles.heroActions}>{footer}</View> : null}
    />
  );
}

const READY_VIEW: CheckInUiStatusView = {
  status: 'ready',
  title: 'Listo para fichar',
  subtitle: 'Fichá hasta las 07:30',
  tone: 'info',
};

function HoyFrame({ fichado }: { fichado?: boolean }) {
  const view = fichado ? resolveCheckInUiStatus(HOY_PRESENTE, null) : READY_VIEW;
  return (
    <View style={styles.body}>
      <Welcome />
      {!fichado ? <AlertChip count={1} /> : null}
      <HeroHoy
        shiftDoc={fichado ? HOY_PRESENTE : HOY}
        view={view}
        extraStatus={
          fichado ? (
            <View style={styles.gpsBox}>
              <Icon name="location" size={16} color="#34d399" />
              <Text style={styles.gpsText}>GPS verificado · a 28 m de {OBJETIVO}</Text>
            </View>
          ) : (
            <View style={styles.gpsBox}>
              <Icon name="location-outline" size={16} color="#fecaca" />
              <Text style={styles.gpsText}>Fichá con GPS en el puesto · {OBJECTIVES_MAP[OBJETIVO_ID].address}</Text>
            </View>
          )
        }
        footer={
          fichado ? null : (
            <>
              <CommandButton label="Presente" variant="success" onPress={() => {}} />
              <CommandButton label="Voy a llegar tarde" variant="onHero" onPress={() => {}} />
            </>
          )
        }
      />
      <QuickRow />
    </View>
  );
}

function ConvocatoriaFrame() {
  return (
    <View style={styles.body}>
      <Welcome />
      <CoberturaConvocatoriasBanner
        convocatorias={[CONVOCATORIA_COBERTURA]}
        highlightedId={CONVOCATORIA_COBERTURA.id}
        onAccept={() => {}}
        onReject={() => {}}
      />
      <HeroHoy
        shiftDoc={HOY_PRESENTE}
        view={resolveCheckInUiStatus(HOY_PRESENTE, null)}
        footer={<CommandButton label="Cómo llegar" variant="onHero" onPress={() => {}} />}
      />
    </View>
  );
}

function VenisFrame() {
  return (
    <View style={styles.body}>
      <Welcome />
      <LlegadaTardeVenisBanner
        convocatorias={[CONVOCATORIA_VENIS]}
        shifts={[HOY]}
        objectivesMap={OBJECTIVES_MAP}
        onSiVoy={() => {}}
        onNoVoy={() => {}}
      />
      <HeroHoy
        shiftDoc={HOY}
        view={{
          status: 'late_window',
          title: 'Podés avisar llegada tarde',
          subtitle: 'Indicá demora de 10, 15 o 30 min',
          tone: 'warning',
        }}
        footer={<CommandButton label="Presente" variant="success" onPress={() => {}} />}
      />
    </View>
  );
}

function AgendaFrame() {
  const { palette } = useTheme();
  const shifts = buildOctubre();
  const byDay = groupShiftsByDateKey(shifts);
  const anchor = new Date(2026, 9, 1);
  const cells = buildMonthCells(anchor, byDay, TODAY);
  /** Día elegido: el próximo T (09/10), así la tarjeta no depende de la hora del build. */
  const selected = new Date('2026-10-09T12:00:00-03:00');
  const selectedKey = toDateKey(selected);
  const dayShifts = byDay[selectedKey] ?? [];
  return (
    <View style={[styles.body, { gap: 12 }]}>
      <AgendaViewSwitcher mode="month" onChange={() => {}} />
      <AgendaPeriodNav title={formatMonthTitle(anchor)} onPrev={() => {}} onNext={() => {}} />
      <AgendaMonthGrid cells={cells} selectedKey={selectedKey} onSelectDay={() => {}} />
      <Text style={[styles.daySection, { color: palette.primary }]}>Turnos · {formatDayTitle(selected)}</Text>
      {dayShifts.map((item) => (
        <AgendaShiftCard key={item.id} item={item} eventosMap={{}} objectivesMap={OBJECTIVES_MAP} />
      ))}
    </View>
  );
}

type InboxFixture = {
  id: string;
  domain: string;
  title: string;
  body?: string;
  receivedAt: string;
  details?: string[];
  kind: 'cobertura' | 'ack' | 'nueva' | 'leida';
  resultLine?: string;
};

const INBOX: InboxFixture[] = [
  {
    id: 'n1',
    domain: 'Cobertura',
    title: 'Convocatoria de cobertura · RET',
    body: `Te convocan para cubrir ${OBJETIVO} · Puesto 2 de 15:00 a 23:00 (T). Respondé antes de que venza.`,
    receivedAt: '02/10/2026 06:35',
    details: [`${CLIENTE} · ${OBJETIVO} · Puesto 2`, 'Código T · 02/10/2026 15:00–23:00'],
    kind: 'cobertura',
  },
  {
    id: 'n2',
    domain: 'Planificación',
    title: 'Cronograma de octubre publicado',
    body: 'Planificación publicó tu malla de octubre. Revisá la agenda y confirmá que la viste.',
    receivedAt: '01/10/2026 18:02',
    kind: 'ack',
  },
  {
    id: 'n3',
    domain: 'Operaciones',
    title: 'Recordatorio: tu turno empieza a las 07:00',
    body: `Tu turno empieza a las 07:00 en ${CLIENTE} · ${OBJETIVO} · ${PUESTO}, ¿estás llegando?`,
    receivedAt: '02/10/2026 06:55',
    kind: 'nueva',
  },
  {
    id: 'n4',
    domain: 'Planificación',
    title: 'Cambio de turno · 09/10 pasa a T',
    receivedAt: '30/09/2026 11:20',
    kind: 'leida',
    resultLine: 'Leída',
  },
];

function AlertasFrame() {
  const { palette } = useTheme();
  const filters = ['Todas', 'Cobertura', 'Planificación', 'Operaciones', 'Eventos', 'Permutas'];
  return (
    <View style={[styles.body, { gap: 10 }]}>
      <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
        Avisos para vos: turnos, eventos y permutas. · 3 sin leer · 1 por confirmar
      </Text>
      <View style={styles.filtersRow}>
        {filters.map((label, i) => {
          const active = i === 0;
          return (
            <View
              key={label}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? palette.primary : palette.inputBg,
                  borderColor: active ? palette.primary : palette.cardBorder,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: active ? palette.onPrimary : palette.onSurfaceMuted }]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.headerActions}>
        <CommandButton label="Marcar todas leídas" variant="secondary" onPress={() => {}} style={styles.headerBtnFlex} />
        <CommandButton label="Borrar todas" variant="ghost" onPress={() => {}} style={styles.headerBtnFlex} />
      </View>
      {INBOX.map((n) => {
        if (n.kind === 'leida') {
          return (
            <View key={n.id} style={[styles.inboxItemCompact, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
              <View style={styles.compactTextCol}>
                <Text style={[styles.domain, { color: palette.onSurfaceMuted }]}>
                  {n.domain} · {n.resultLine}
                </Text>
                <Text style={[styles.inboxTitleCompact, { color: palette.onSurface }]} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={[styles.metaLine, { color: palette.onSurfaceMuted }]}>Recibida {n.receivedAt}</Text>
              </View>
              <CommandButton label="Quitar" variant="ghost" onPress={() => {}} style={styles.quitarCompact} />
            </View>
          );
        }
        const isCoverage = n.kind === 'cobertura';
        const needsAck = n.kind === 'ack';
        return (
          <View
            key={n.id}
            style={[styles.inboxItem, { backgroundColor: palette.card, borderColor: needsAck ? palette.warning : palette.primary }]}
          >
            <View style={styles.inboxTop}>
              <Text style={[styles.domain, { color: isCoverage ? palette.error : palette.primary }]}>{n.domain}</Text>
              <Text style={[styles.nueva, { color: needsAck ? palette.warning : palette.error }]}>
                {isCoverage ? 'Responder' : needsAck ? 'Confirmar' : 'Nueva'}
              </Text>
            </View>
            <Text style={[styles.receivedAt, { color: palette.onSurfaceMuted }]}>Recibida {n.receivedAt}</Text>
            <Text style={[styles.inboxTitle, { color: palette.onSurface }]}>{n.title}</Text>
            {n.body ? <Text style={[styles.inboxBody, { color: palette.onSurfaceMuted }]}>{n.body}</Text> : null}
            {n.details ? (
              <View style={[styles.detailBox, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
                {n.details.map((line) => (
                  <Text key={line} style={[styles.detailLine, { color: palette.onSurface }]}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.rowBtns}>
              {isCoverage ? (
                <>
                  <CommandButton label="Aceptar" variant="success" onPress={() => {}} style={styles.btnFlex} />
                  <CommandButton label="Rechazar" variant="danger" onPress={() => {}} style={styles.btnFlex} />
                </>
              ) : needsAck ? (
                <>
                  <CommandButton label="Me enteré" variant="success" onPress={() => {}} style={styles.btnFlex} />
                  <CommandButton label="Ver agenda" variant="secondary" onPress={() => {}} style={styles.btnFlex} />
                </>
              ) : (
                <CommandButton label="Ver turno" variant="secondary" onPress={() => {}} style={styles.btnFlex} />
              )}
              <CommandButton label="Quitar" variant="ghost" onPress={() => {}} style={styles.btnFlex} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CredencialFrame() {
  const { palette } = useTheme();
  return (
    <View style={styles.body}>
      <Text style={[styles.welcomeLabel, { color: palette.primary }]}>{EMPRESA}</Text>
      <Text style={[styles.welcomeName, { color: palette.onSurface }]}>Credencial</Text>
      <CommandCard style={styles.center}>
        <View style={styles.qr}>
          <QRCode value="COSP-PLAY-REVIEW-DEMO" size={148} />
        </View>
        <Text style={[styles.cardTitle, { color: palette.onSurface }]}>{GUARDIA}</Text>
        <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>DNI 00.000.000</Text>
        <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>Legajo {LEGAJO} · Vigilador</Text>
      </CommandCard>
    </View>
  );
}

function ContratosFrame() {
  const { palette } = useTheme();
  return (
    <View style={styles.body}>
      <Text style={[styles.welcomeLabel, { color: palette.primary }]}>{EMPRESA}</Text>
      <Text style={[styles.welcomeName, { color: palette.onSurface }]}>Mis contratos</Text>
      <CommandCard>
        <Text style={[styles.domain, { color: palette.primary }]}>Vigente</Text>
        <Text style={[styles.cardTitle, { color: palette.onSurface }]}>Contrato marco de prueba</Text>
        <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>01/10/2026 al 31/10/2026</Text>
        <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>Jornada mañana · datos de demostración</Text>
        <CommandButton label="Acusar recibo" onPress={() => {}} />
      </CommandCard>
    </View>
  );
}

const FRAME_META: Record<Frame, { title: string; tab: TabKey }> = {
  hoy: { title: 'Hoy', tab: 'Hoy' },
  fichada: { title: 'Hoy', tab: 'Hoy' },
  convocatoria: { title: 'Hoy', tab: 'Hoy' },
  venis: { title: 'Hoy', tab: 'Hoy' },
  agenda: { title: 'Agenda', tab: 'Agenda' },
  alertas: { title: 'Alertas', tab: 'Alertas' },
  credencial: { title: 'Credencial', tab: 'Más' },
  contratos: { title: 'Mis contratos', tab: 'Más' },
};

export default function PlayCapturasScreen() {
  const params = useLocalSearchParams<{ frame?: string }>();
  const frame = frameOf(params.frame);
  const { palette } = useTheme();
  const meta = FRAME_META[frame];
  const badge = frame === 'fichada' ? undefined : frame === 'alertas' ? 3 : 1;

  return (
    <View style={[styles.safe, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <IconFontStyle />
      <Header title={meta.title} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {frame === 'hoy' ? <HoyFrame /> : null}
        {frame === 'fichada' ? <HoyFrame fichado /> : null}
        {frame === 'convocatoria' ? <ConvocatoriaFrame /> : null}
        {frame === 'venis' ? <VenisFrame /> : null}
        {frame === 'agenda' ? <AgendaFrame /> : null}
        {frame === 'alertas' ? <AlertasFrame /> : null}
        {frame === 'credencial' ? <CredencialFrame /> : null}
        {frame === 'contratos' ? <ContratosFrame /> : null}
      </ScrollView>
      <TabBar active={meta.tab} badge={badge} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, minHeight: '100%' },
  header: { paddingTop: 14, paddingBottom: 14, paddingHorizontal: 16 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  scroll: { paddingBottom: 12, flexGrow: 1 },
  body: { padding: spacing.container, gap: spacing.lg },
  welcome: { gap: 4 },
  welcomeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  welcomeName: { fontSize: 26, fontWeight: '800' },
  welcomeMeta: { fontSize: 14, fontWeight: '600' },
  alertChip: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  alertChipText: { fontSize: 13, fontWeight: '800' },
  heroActions: { marginTop: 12, gap: 10 },
  gpsBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  gpsText: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '700', flex: 1 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickHalf: { flex: 1, gap: 6 },
  quickTitle: { fontSize: 15, fontWeight: '800' },
  quickSub: { fontSize: 12, fontWeight: '600' },
  daySection: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  intro: { fontSize: 14, lineHeight: 21 },
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  filterText: { fontSize: 11, fontWeight: '800' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtnFlex: { flex: 1 },
  inboxItem: { borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  inboxItemCompact: {
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactTextCol: { flex: 1, minWidth: 0 },
  quitarCompact: { flexGrow: 0, flexShrink: 0, minWidth: 88, paddingHorizontal: 10 },
  inboxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  domain: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  nueva: { fontSize: 11, fontWeight: '800' },
  inboxTitle: { fontWeight: '800', fontSize: 15 },
  inboxTitleCompact: { fontWeight: '700', fontSize: 13, marginTop: 2 },
  inboxBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  receivedAt: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  metaLine: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  detailBox: { marginTop: 8, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  detailLine: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  btnFlex: { flexGrow: 1, flexBasis: '45%', minWidth: 120 },
  center: { alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '800' },
  qr: { backgroundColor: '#fff', padding: 8, borderRadius: radius.md },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6, paddingBottom: 8, height: 56 + 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 2 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
