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
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { usePortalAuth } from '../src/context/PortalAuthContext';
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
};

export default function PreviewPickerScreen() {
  const router = useRouter();
  const { emp: empParam } = useLocalSearchParams<{ emp?: string | string[] }>();
  const deepLinkEmpId = typeof empParam === 'string' ? empParam : Array.isArray(empParam) ? empParam[0] : undefined;
  const { palette } = useTheme();
  const { user, initializing, isSuperAdmin, enterPreview, signOut } = usePortalAuth();
  const [employees, setEmployees] = useState<PreviewEmployee[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadingList(true);
    const { db } = getPortalFirebase();
    void getDocs(query(collection(db, 'empleados'), orderBy('lastName'), limit(500)))
      .then((snap) => {
        if (cancelled) return;
        setEmployees(
          snap.docs.map((d) => {
            const data = d.data();
            const name = `${data.lastName || ''}, ${data.firstName || data.nombre || ''}`
              .trim()
              .replace(/^,\s*/, '');
            return {
              id: d.id,
              name: name || d.id,
              empresa: data.empresaId || '',
              fileNumber: data.fileNumber || data.legajo || '',
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const empresas = useMemo(
    () => Array.from(new Set(employees.map((e) => e.empresa).filter(Boolean))).sort() as string[],
    [employees],
  );

  const filtered = useMemo(
    () =>
      employees.filter((e) => {
        const matchEmpresa = !empresaFilter || e.empresa === empresaFilter;
        const q = search.trim().toLowerCase();
        const matchSearch =
          !q ||
          e.name.toLowerCase().includes(q) ||
          (e.fileNumber && e.fileNumber.toLowerCase().includes(q));
        return matchEmpresa && matchSearch;
      }),
    [employees, empresaFilter, search],
  );

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;
  const previewLink = selectedId ? buildMobilePreviewDeepLink(selectedId) : null;

  useEffect(() => {
    if (initializing || !isSuperAdmin || !deepLinkEmpId?.trim()) return;
    let cancelled = false;
    setEntering(true);
    void enterPreview(deepLinkEmpId.trim())
      .then(() => {
        if (!cancelled) router.replace(appRoutes.hoy);
      })
      .finally(() => {
        if (!cancelled) setEntering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initializing, isSuperAdmin, deepLinkEmpId, enterPreview, router]);

  async function handleEnter(empId: string) {
    setEntering(true);
    try {
      await enterPreview(empId);
      router.replace(appRoutes.hoy);
    } finally {
      setEntering(false);
    }
  }

  if (initializing || (deepLinkEmpId && entering)) {
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
            {filtered.length} empleado{filtered.length !== 1 ? 's' : ''}
            {empresaFilter ? ` · ${empresaFilter}` : empresas.length ? ` · ${empresas.length} empresas` : ''}
          </Text>
        </View>

        {empresas.length > 1 ? (
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
            placeholder="Buscar por nombre o legajo…"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[styles.searchInput, { color: palette.onSurface }]}
            autoCorrect={false}
          />
        </View>

        {loadingList ? (
          <ActivityIndicator color={palette.primary} style={styles.loader} />
        ) : (
          <FlatList
            data={filtered.slice(0, 80)}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>
                {employees.length === 0 ? 'Cargando empleados…' : `Sin resultados para "${search}"`}
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
              onPress={() => void handleEnter(selectedEmployee.id)}
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
  footer: { paddingHorizontal: spacing.container, paddingBottom: 12 },
});
