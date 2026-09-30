import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePortalAuth } from '../context/PortalAuthContext';
import { EnableWebPushButton } from './EnableWebPushButton';
import { radius } from '../theme/tokens';

export function PreviewModeBanner() {
  const router = useRouter();
  const { isPreviewMode, employee, previewEmpDocId, exitPreview, isEventual, bolsaCuil } = usePortalAuth();

  if (!isPreviewMode) return null;

  const label =
    employee?.lastName || employee?.firstName
      ? `${employee.lastName ?? ''} ${employee.firstName ?? ''}`.trim()
      : isEventual
        ? bolsaCuil || 'Eventual'
        : previewEmpDocId ?? 'Guardia';

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label} numberOfLines={2}>
          PREVIEW · {label}
          {`\nConvocatorias: Acepto/No puedo actúan como este ${isEventual ? 'eventual' : 'legajo'}.`}
        </Text>
        <Pressable
          style={styles.btn}
          onPress={() => {
            void exitPreview().then(() => {
              router.push('/preview');
            });
          }}
        >
          <Text style={styles.btnText}>Cambiar</Text>
        </Pressable>
      </View>
      <EnableWebPushButton compact />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#ea580c',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  btnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
