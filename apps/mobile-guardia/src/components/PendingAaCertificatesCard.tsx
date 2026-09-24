import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CommandButton } from './ui/CommandButton';
import { CommandCard } from './ui/CommandCard';
import { CertificateAttachmentField } from './CertificateAttachmentField';
import type { LocalCertificateFile } from '../lib/uploadAbsenceCertificate';
import type { PendingAaAbsence } from '../hooks/usePendingAaCertificates';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  items: PendingAaAbsence[];
  uploadingId: string | null;
  onUpload: (
    ausenciaId: string,
    file: LocalCertificateFile,
  ) => Promise<{ ok: boolean; message: string }>;
};

export function PendingAaCertificatesCard({ items, uploadingId, onUpload }: Props) {
  const { palette } = useTheme();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [file, setFile] = useState<LocalCertificateFile | null>(null);

  if (items.length === 0) return null;

  return (
    <CommandCard title="Ausencia sin justificar">
      <Text style={[styles.lead, { color: palette.onSurfaceMuted }]}>
        Si tenés certificado médico, subilo antes de las 23:59 para evitar que quede como
        injustificada.
      </Text>
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Text style={[styles.date, { color: palette.onSurface }]}>
            {item.startDate}
            {item.objectiveName ? ` · ${item.objectiveName}` : ''}
          </Text>
          {item.reason ? (
            <Text style={[styles.reason, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
              {item.reason}
            </Text>
          ) : null}
          {activeId === item.id ? (
            <View style={styles.uploadBox}>
              <CertificateAttachmentField value={file} onChange={setFile} disabled={!!uploadingId} />
              <CommandButton
                label={uploadingId === item.id ? 'Subiendo…' : 'Enviar certificado'}
                variant="primary"
                loading={uploadingId === item.id}
                disabled={!file || !!uploadingId}
                onPress={async () => {
                  if (!file) return;
                  const result = await onUpload(item.id, file);
                  Alert.alert(result.ok ? 'Enviado' : 'Error', result.message);
                  if (result.ok) {
                    setActiveId(null);
                    setFile(null);
                  }
                }}
              />
              <CommandButton
                label="Cancelar"
                variant="ghost"
                onPress={() => {
                  setActiveId(null);
                  setFile(null);
                }}
              />
            </View>
          ) : (
            <CommandButton
              label="Subir certificado"
              variant="secondary"
              onPress={() => {
                setActiveId(item.id);
                setFile(null);
              }}
            />
          )}
        </View>
      ))}
    </CommandCard>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  row: { gap: 6, marginBottom: 10 },
  date: { fontSize: 14, fontWeight: '700' },
  reason: { fontSize: 12, lineHeight: 17 },
  uploadBox: { gap: 8, marginTop: 4 },
});
