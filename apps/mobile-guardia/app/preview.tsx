import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { appRoutes } from '../src/lib/appRoutes';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { esLegajoDeBolsa } from '../src/lib/previewEventual';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { CommandButton } from '../src/components/ui/CommandButton';
import { buildMobilePreviewDeepLink } from '../src/lib/previewLinks';
import { getPortalFirebase } from '../src/lib/portal';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

type PreviewEmployee = {
  id: string;
  name: string;
  empresa?: string;
  fileNumber?: string;
  kind: 'legajo' | 'eventual';
  bolsaCuil?: string;
};

type PreviewTab = 'legajos' | 'eventuales';

export default function PreviewPickerScreen() {
  const router = useRouter();
  const { emp: empParam, bolsa: bolsaParam } = useLocalSearchParams<{
    emp?: string | string[];
    bolsa?: string | string[];
  }>();
  const deepLinkEmpId = typeof empParam === 'string' ? empParam : Array.isArray(empParam) ? empParam[0] : undefined;
  const deepLinkBolsa =
    typeof bolsaParam === 'string' ? bolsaParam : Array.isArray(bolsaParam) ? bolsaParam[0] : undefined;
  const { palette } = useTheme();
  const { user, initializing, isSuperAdmin, enterPreview, enterPreviewEventual, signOut } = usePortalAuth();
  const [tab, setTab] = useState<PreviewTab>('legajos');
  const [employees, setEmployees] = useState<PreviewEmployee[]>([]);
  const [eventuales, setEventuales] = useState<PreviewEmployee[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listReloadKey, setListReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadingList(true);
    setListError(null);
    const { db } = getPortalFirebase();
    void Promise.all([
      getDocs(query(collection(db, 'empleados'), orderBy('lastName'))),
      getDocs(collection(db, 'eventuales_bolsa')),
    ])
      .then(([empSnap, bolsaSnap]) => {
        if (cancelled) return;
        setEmployees(
          empSnap.docs
            .filter((d) => !esLegajoDeBolsa(d.data()))
            .map((d) => {
              const data = d.data();
              const name = `${data.lastName || ''}, ${data.firstName || data.nombre || ''}`
                .trim()
                .replace(/^,\s*/, '');
              return {
                id: d.id,
                name: name || d.id,
                empresa: data.empresaId || '',
                fileNumber: data.fileNumber || data.legajo || '',
                kind: 'legajo' as const,
              };
            }),
        );
        setEventuales(
          bolsaSnap.docs
            .map((d) => {
              const data = d.data();
              const n = Array.isArray(data.legajos) ? data.legajos.length : 0;
              return {
                id: d.id,
                name: String(data.nombre || d.id),
                empresa: n ? `${n} empresa${n === 1 ? '' : 's'}` : 'Sin legajo todavía',
                fileNumber: d.id,
                kind: 'eventual' as const,
                bolsaCuil: d.id,
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setEmployees([]);
        setListError(err instanceof Error ? err.message : 'No se pudo cargar el listado de empleados');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, listReloadKey]);

  const empresas = useMemo(
    () => Array.from(new Set(employees.map((e) => e.empresa).filter(Boolean))).sort() as string[],
    [employees],
  );

  const source = tab === 'eventuales' ? eventuales : employees;
  const filtered = useMemo(
    () =>
      source.filter((e) => {
        const matchEmpresa = !empresaFilter || e.empresa === empresaFilter;
        const q = search.trim().toLowerCase();
        const matchSearch =
          !q ||
          e.name.toLowerCase().includes(q) ||
          (e.fileNumber && e.fileNumber.toLowerCase().includes(q));
        return matchEmpresa && matchSearch;
      }),
    [source, empresaFilter, search],
  );

  const selectedEmployee = source.find((e) => e.id === selectedId) ?? null;
  const previewLink = selectedEmployee
    ? selectedEmployee.kind === 'eventual'
      ? buildMobilePreviewDeepLink('', { bolsaCuil: selectedEmployee.bolsaCuil || selectedEmployee.id })
      : buildMobilePreviewDeepLink(selectedEmployee.id)
    : null;

  useEffect(() => {
    const bolsa = deepLinkBolsa?.trim();
    const emp = deepLinkEmpId?.trim();
    if (initializing || !isSuperAdmin || (!bolsa && !emp)) return;
    let cancelled = false;
    setEntering(true);
    const open = bolsa ? enterPreviewEventual(bolsa) : enterPreview(emp!);
    void open
      .then(() => {
        if (!cancelled) router.replace(appRoutes.hoy);
      })
      .finally(() => {
        if (!cancelled) setEntering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initializing, isSuperAdmin, deepLinkEmpId, deepLinkBolsa, enterPreview, enterPreviewEventual, router]);

  async function handleEnter(row: PreviewEmployee) {
    setEntering(true);
    try {
      if (row.kind === 'eventual') await enterPreviewEventual(row.bolsaCuil || row.id);
      else await enterPreview(row.id);
      router.replace(appRoutes.hoy);
    } finally {
      setEntering(false);
    }
  }

  if (initializing || ((deepLinkEmpId || deepLinkBolsa) && entering)) {
    return <LoadingScreen label="Abriendo vista previa…" />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (!isSuperAdmin) {
    return <Redirect href="/home" />;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Vista previa', headerShown: true }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.onSurface }]}>Vista previa portal guardia</Text>
          <Text style={[styles.sub, { color: palette.onSurfaceMuted }]}>
            {filtered.length} {tab === 'eventuales' ? 'eventual' : 'empleado'}{filtered.length !== 1 ? 'es' : ''}
            {empresaFilter ? ` · ${empresaFilter}` : empresas.length ? ` · ${empresas.length} empresas` : ''}
          </Text>
        </View>

        <View style={styles.tabs}>
          {(['legajos', 'eventuales'] as const).map((key) => {
            const active = tab === key;
            const label = key === 'legajos' ? `Legajos (${employees.length})` : `Eventuales (${eventuales.length})`;
            return (
              <Pressable
                key={key}
                style={[styles.tab, active ? styles.chipActive : styles.chipIdle]}
                onPress={() => {
                  setTab(key);
                  setSelectedId(null);
                  setEmpresaFilter(null);
                }}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'legajos' && empresas.length > 1 ? (
          <View style={styles.chipsRow}>
            <Pressable
              style={[styles.chip, !empresaFilter ? styles.chipActive : styles.chipIdle]}
              onPress={() => setEmpresaFilter(null)}
            >
              <Text style={[styles.chipText, !empresaFilter ? styles.chipTextActive : null]}>Todas</Text>
            </Pressable>
            {empresas.map((emp) => (
              <Pressable
                key={emp}
                style={[styles.chip, empresaFilter === emp ? styles.chipActive : styles.chipIdle]}
                onPress={() => setEmpresaFilter(empresaFilter === emp ? null : emp)}
              >
                <Text style={[styles.chipText, empresaFilter === emp ? styles.chipTextActive : null]}>{emp}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={[styles.searchWrap, { borderColor: palette.outline, backgroundColor: palette.inputBg }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={tab === 'eventuales' ? 'Buscar por nombre o CUIL…' : 'Buscar por nombre o legajo…'}
            placeholderTextColor={palette.onSurfaceMuted}
            style={[styles.searchInput, { color: palette.onSurface }]}
            autoCorrect={false}
          />
        </View>

        {loadingList ? (
          <ActivityIndicator color={palette.primary} style={styles.loader} />
        ) : listError ? (
          <View style={styles.errorBox}>
            <Text style={[styles.empty, { color: palette.error }]}>{listError}</Text>
            <CommandButton
              label="Reintentar"
              variant="secondary"
              onPress={() => setListReloadKey((k) => k + 1)}
            />
          </View>
        ) : (
          <FlatList
            style={styles.listFlex}
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            windowSize={10}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>
                {source.length === 0
                  ? tab === 'eventuales'
                    ? 'No hay eventuales en la bolsa.'
                    : 'No hay empleados para mostrar.'
                  : `Sin resultados para "${search}".`}
              </Text>
            }
            renderItem={({ item }) => {
              const active = selectedId === item.id;
              return (
                <Pressable
                  style={[
                    styles.row,
                    {
                      backgroundColor: active ? '#ea580c' : palette.card,
                      borderColor: active ? '#ea580c' : palette.cardBorder,
                    },
                  ]}
                  onPress={() => setSelectedId(item.id)}
                >
                  <View style={[styles.avatar, active ? styles.avatarActive : null]}>
                    <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: active ? '#fff' : palette.onSurface }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.rowSub, { color: active ? '#ffedd5' : palette.onSurfaceMuted }]} numberOfLines={1}>
                      {item.fileNumber ? `#${item.fileNumber}` : ''}
                      {item.fileNumber && item.empresa ? ' · ' : ''}
                      {item.empresa || ''}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        {selectedEmployee && previewLink ? (
          <View style={[styles.qrPanel, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}>
            <Text style={[styles.qrTitle, { color: palette.onSurface }]}>QR para ingresar en la app</Text>
            <Text style={[styles.qrHint, { color: palette.onSurfaceMuted }]}>
              Modo Expo Go: escaneá con otro celular (SuperAdmin logueado). Requiere npm run dev:mobile en la PC.
            </Text>
            <View style={styles.qrWrap}>
              <QRCode value={previewLink} size={148} backgroundColor="#fff" color="#0f172a" />
            </View>
            <Text style={[styles.qrUrl, { color: palette.primary }]} selectable numberOfLines={2}>
              {previewLink}
            </Text>
            <CommandButton
              label={entering ? 'Ingresando…' : `Entrar como ${selectedEmployee.name.split(',')[0]}`}
              onPress={() => void handleEnter(selectedEmployee)}
              disabled={entering}
            />
          </View>
        ) : null}

        <View style={styles.footer}>
          <CommandButton label="Cerrar sesión admin" variant="secondary" onPress={() => void signOut()} />
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: spacing.container, paddingTop: 8, paddingBottom: 4, gap: 4 },
  title: { fontSize: 18, fontWeight: '900' },
  sub: { fontSize: 12, fontWeight: '600' },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.container,
    paddingTop: 8,
  },
  tab: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.container,
    paddingVertical: 8,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: '#ea580c' },
  chipIdle: { backgroundColor: '#1e293b' },
  chipText: { fontSize: 11, fontWeight: '800', color: '#94a3b8' },
  chipTextActive: { color: '#fff' },
  searchWrap: {
    marginHorizontal: spacing.container,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  searchInput: { paddingVertical: 12, fontSize: 15, fontWeight: '600' },
  loader: { marginTop: 32 },
  errorBox: {
    paddingHorizontal: spacing.container,
    paddingVertical: 24,
    gap: 12,
  },
  listFlex: { flex: 1 },
  list: { paddingHorizontal: spacing.container, paddingBottom: 12, gap: 8 },
  empty: { textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowSub: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  qrPanel: {
    marginHorizontal: spacing.container,
    marginBottom: 8,
    padding: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: 8,
    alignItems: 'center',
  },
  qrTitle: { fontSize: 14, fontWeight: '900', alignSelf: 'flex-start' },
  qrHint: { fontSize: 12, lineHeight: 17, alignSelf: 'flex-start' },
  qrWrap: {
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: '#fff',
    marginTop: 4,
  },
  qrUrl: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  footer: {
    paddingHorizontal: spacing.container,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
});
