import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommandButton } from '../src/components/ui/CommandButton';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { mapPortalCallableError } from '../src/lib/mapPortalCallableError';
import { getPortalFirebase } from '../src/lib/portal';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';
import { appAlert } from '@/lib/appAlert';

type Pedido = { mensaje?: string; canales?: string[] };

export default function CodigoAnexoScreen() {
  return (
    <RequireAuth>
      <CodigoAnexoContent />
    </RequireAuth>
  );
}

function CodigoAnexoContent() {
  const params = useLocalSearchParams<{ contratoId?: string; convocatoriaId?: string }>();
  const contratoId = String(params.contratoId || '');
  const convocatoriaId = String(params.convocatoriaId || '');
  const { palette } = useTheme();
  const [mensaje, setMensaje] = useState('Estamos enviando el código…');
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [puedeConfirmar, setPuedeConfirmar] = useState(false);
  const pedido = useRef(false);

  const pedir = useCallback(async () => {
    if (!contratoId && !convocatoriaId) {
      setMensaje('Falta el contrato. Volvé a Mis contratos.');
      return;
    }
    setBusy(true);
    try {
      const { functions } = getPortalFirebase();
      const call = httpsCallable<{ contratoId?: string; convocatoriaId?: string }, Pedido>(
        functions,
        'pedirCodigoAnexoEventual',
      );
      const res = await call({
        ...(contratoId ? { contratoId } : {}),
        ...(convocatoriaId ? { convocatoriaId } : {}),
      });
      setMensaje(res.data.mensaje || 'Te enviamos un código de 6 dígitos.');
      setPuedeConfirmar(true);
    } catch (err) {
      setMensaje(mapPortalCallableError(err));
      setPuedeConfirmar(false);
    } finally {
      setBusy(false);
    }
  }, [contratoId, convocatoriaId]);

  useEffect(() => {
    if (pedido.current) return;
    pedido.current = true;
    void pedir();
  }, [pedir]);

  const confirmar = useCallback(async () => {
    setBusy(true);
    try {
      const { functions } = getPortalFirebase();
      const call = httpsCallable(functions, 'confirmarAnexoEventual');
      await call({
        ...(contratoId ? { contratoId } : {}),
        ...(convocatoriaId ? { convocatoriaId } : {}),
        codigo: codigo.trim(),
      });
      setPuedeConfirmar(false);
      appAlert('Anexo confirmado', 'El código era válido. Quedó registrada la conformidad.');
    } catch (err) {
      appAlert('Código', mapPortalCallableError(err));
    } finally {
      setBusy(false);
    }
  }, [codigo, contratoId, convocatoriaId]);

  return (
    <>
      <Stack.Screen options={{ title: 'Código del anexo' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <View style={styles.body}>
          <Text style={[styles.mensaje, { color: palette.onSurface }]}>{mensaje}</Text>
          {puedeConfirmar ? (
            <>
              <TextInput
                value={codigo}
                onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="6 dígitos"
                placeholderTextColor={palette.onSurfaceMuted}
                style={[
                  styles.input,
                  { color: palette.onSurface, borderColor: palette.cardBorder, backgroundColor: palette.inputBg },
                ]}
              />
              <CommandButton
                label={busy ? 'Confirmando…' : 'Confirmar anexo'}
                variant="success"
                loading={busy}
                disabled={busy || codigo.length !== 6}
                onPress={() => void confirmar()}
              />
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: spacing.container, gap: spacing.md },
  mensaje: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: 14,
  },
});
