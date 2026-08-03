import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  absenceSubmitToastMessageForType,
  absenceTypeEmployeeLabel,
  absenceTypeEmployeeHint,
  classifyAbsenceForEmployee,
  dateKeyLocal,
  filterAbsenceTypesForFeatures,
  type AbsenceType,
} from '@cosp/portal-core';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { getPortalFirebase } from '../src/lib/portal';
import {
  uploadAbsenceCertificate,
  type LocalCertificateFile,
} from '../src/lib/uploadAbsenceCertificate';
import { CertificateAttachmentField } from '../src/components/CertificateAttachmentField';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { colors, radius } from '../src/theme/tokens';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  return dateKeyLocal(new Date());
}

function typeAcceptsCertificate(type: AbsenceType): boolean {
  return type === 'Enfermedad' || type === 'ART';
}

export default function NovedadScreen() {
  const router = useRouter();
  const { user, employee, empDocId, portalFeatures, initializing } = usePortalAuth();
  const { shifts } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { db } = getPortalFirebase();

  const typeOptions = useMemo(
    () =>
      filterAbsenceTypesForFeatures({
        reportAbsence: portalFeatures.reportAbsence,
        requestLicense: portalFeatures.requestLicense,
      }),
    [portalFeatures.reportAbsence, portalFeatures.requestLicense],
  );

  const [absenceType, setAbsenceType] = useState<AbsenceType>(typeOptions[0] ?? 'Ausencia con aviso');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(todayKey());
  const [reason, setReason] = useState('');
  const [certificate, setCertificate] = useState<LocalCertificateFile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const displayName = useMemo(() => {
    if (employee?.lastName || employee?.firstName) {
      return `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim();
    }
    return user?.email || 'Empleado';
  }, [employee, user]);

  const canAccess = portalFeatures.reportAbsence || portalFeatures.requestLicense;
  const showCertificate = typeAcceptsCertificate(absenceType);

  async function handleSubmit() {
    if (!user) return;
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      Alert.alert('Fechas', 'Usá formato AAAA-MM-DD (ej. 2026-07-30).');
      return;
    }
    if (endDate < startDate) {
      Alert.alert('Fechas', 'La fecha hasta no puede ser anterior al desde.');
      return;
    }
    if (!reason.trim()) {
      Alert.alert('Motivo', 'Indicá el motivo de la novedad.');
      return;
    }

    const classified = classifyAbsenceForEmployee({
      absenceStart: startDate,
      shifts,
    });

    const employeeKey = empDocId?.trim() || user.uid;

    setSubmitting(true);
    try {
      let fileUrl: string | null = null;
      let fileName: string | null = null;
      let certificateStoragePath: string | null = null;
      if (showCertificate && certificate) {
        const uploaded = await uploadAbsenceCertificate(user.uid, certificate);
        fileUrl = uploaded.url;
        fileName = uploaded.name;
        certificateStoragePath = uploaded.storagePath;
      }

      const empresaId = String(employee?.empresaId || 'bacarsa').trim();
      await addDoc(collection(db, 'ausencias'), {
        employeeId: employeeKey,
        employeeName: displayName,
        type: absenceType,
        startDate,
        endDate,
        status: 'Pendiente',
        hasCertificate: !!fileUrl,
        certificateUrl: fileUrl,
        certificateName: fileName,
        certificateStoragePath,
        reason: reason.trim(),
        source: 'EMPLEADO',
        createdAt: serverTimestamp(),
        absenceCase: classified.absenceCase,
        minutesBeforeShift: classified.minutesBeforeShift,
        handledBy: classified.handledBy,
        receivedAt: serverTimestamp(),
        shiftId: classified.shiftId,
        objectiveId: classified.objectiveId,
        objectiveName: classified.objectiveName,
        positionName: classified.positionName,
        clientId: classified.clientId,
        ...(empresaId ? { empresaId } : {}),
      });

      const certNote = fileUrl ? ' El certificado quedó adjunto.' : '';
      const toastMsg = absenceSubmitToastMessageForType(absenceType, classified.absenceCase);
      Alert.alert('Enviado', `${toastMsg}${certNote}`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
      setReason('');
      setCertificate(null);
      setStartDate(todayKey());
      setEndDate(todayKey());
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo enviar la solicitud';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  }

  if (initializing) return null;

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (!canAccess || typeOptions.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Novedad' }} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={styles.blocked}>
            <Text style={styles.blockedTitle}>Módulo no habilitado</Text>
            <Text style={styles.blockedBody}>Tu empresa no tiene activas ausencias o licencias en el portal.</Text>
            <CommandButton label="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Solicitar novedad' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>
              Informá ausencias, licencias o que hoy no vas a asistir. RRHH y Operaciones reciben el aviso según urgencia.
            </Text>

            <CommandCard title="Tipo">
              <View style={styles.chips}>
                {typeOptions.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setAbsenceType(t);
                      if (!typeAcceptsCertificate(t)) setCertificate(null);
                    }}
                    style={[styles.chip, absenceType === t && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, absenceType === t && styles.chipTextActive]}>
                      {absenceTypeEmployeeLabel(t)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {absenceTypeEmployeeHint(absenceType) ? (
                <Text style={styles.typeHint}>{absenceTypeEmployeeHint(absenceType)}</Text>
              ) : null}
            </CommandCard>

            <CommandCard title="Período">
              <Text style={styles.label}>Desde (AAAA-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="2026-07-30"
                placeholderTextColor={colors.slate500}
                autoCapitalize="none"
              />
              <Text style={styles.label}>Hasta (AAAA-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="2026-07-30"
                placeholderTextColor={colors.slate500}
                autoCapitalize="none"
              />
            </CommandCard>

            <CommandCard title="Motivo">
              <TextInput
                style={[styles.input, styles.textArea]}
                value={reason}
                onChangeText={setReason}
                placeholder="Describí brevemente el motivo…"
                placeholderTextColor={colors.slate500}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
              {showCertificate ? (
                <CertificateAttachmentField
                  value={certificate}
                  onChange={setCertificate}
                  disabled={submitting}
                />
              ) : null}
            </CommandCard>

            <CommandButton
              label={submitting ? 'Enviando…' : 'Enviar solicitud'}
              loading={submitting}
              onPress={handleSubmit}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.slate50 },
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 16, paddingBottom: 32 },
  intro: { fontSize: 14, color: colors.slate500, lineHeight: 21 },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: colors.slate950,
    backgroundColor: colors.white,
  },
  textArea: { minHeight: 100 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.slate50,
  },
  chipActive: {
    backgroundColor: colors.indigo600,
    borderColor: colors.indigo800,
  },
  chipText: { fontSize: 12, fontWeight: '800', color: colors.slate600 },
  chipTextActive: { color: colors.white },
  typeHint: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 18 },
  blocked: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  blockedTitle: { fontSize: 20, fontWeight: '900', color: colors.slate950 },
  blockedBody: { fontSize: 14, color: colors.slate500, lineHeight: 22 },
});
