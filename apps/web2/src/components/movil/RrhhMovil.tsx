import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { arrayUnion, collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { toast } from 'sonner';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { RrhhScreens, type RrhhPanel } from '@/components/movil/RrhhScreens';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, storage } from '@/lib/firebase';
import { movilCallableGate } from '@/lib/movil/callableOnline';
import { crearNovedadRapida } from '@/lib/movil/novedadRapida';
import { esAusenciaInjustificada, patchJustificarAusencia, resumenDiaRrhh, TIPOS_JUSTIFICAR_DEFAULT, tiposParaJustificar, type AusenciaDia } from '@/lib/movil/rrhhDia';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import { shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { absenceNeedsMedicalVerification, absenceReplicatesToPlanning } from '@/lib/planificacion/absenceCodes';
import { endDateFromDefaultDays } from '@/lib/rrhh/novedadTypes';
import { avisarNovedadDeAusencia, replicarAusenciaPlanificador } from '@/lib/rrhh/replicarAusenciaPlanificador';
import { absenceService, type Absence } from '@/services/absenceService';
import { novedadTypeService } from '@/services/novedadTypeService';

// date-fns rompe el build de producción en esta página (import de directorio en ESM).
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dos = (n: number) => String(n).padStart(2, '0');
const diaCorto = (d: Date) => `${DIAS[d.getDay()]} ${dos(d.getDate())}/${dos(d.getMonth() + 1)}`;
const diaLargo = (d: Date) => `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;

type Guardia = { id: string; nombre: string; telefono: string; preferredObjectiveId?: string };
const CACHE = 'cosp-movil-rrhh-dia';

function ymd(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function RrhhMovil() {
  const { isSuperAdmin, canReadModule, user } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const online = useOnlineFlag();
  const empresaSheet = useEmpresaSheet();
  const permitido = isSuperAdmin || canReadModule('RRHH');
  const router = useRouter();
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const panelQuery = String(router.query.panel || '');
  const panel: RrhhPanel = fichaAbierta ? 'ficha' : panelQuery === 'ausencia' || panelQuery === 'novedad' ? panelQuery : 'dia';
  const setPanel = (next: RrhhPanel) => {
    setFichaAbierta(next === 'ficha');
    if (next === 'ficha') return;
    void router.push(next === 'dia' ? '/admin/rrhh/movil/' : `/admin/rrhh/movil/?panel=${next}`);
  };
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [ausencias, setAusencias] = useState<AusenciaDia[]>([]);
  const [guardias, setGuardias] = useState<Guardia[]>([]);
  const [tipos, setTipos] = useState<{ id: string; label: string; code: string; defaultDays: number | null }[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [elegidaId, setElegidaId] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [dias, setDias] = useState('1');
  const [foto, setFoto] = useState<File | null>(null);
  const [novedadTipo, setNovedadTipo] = useState('Observación');
  const [novedadTexto, setNovedadTexto] = useState('');
  const [turnos, setTurnos] = useState<{ id: string; dia: string; codigo: string }[]>([]);
  const [justificarId, setJustificarId] = useState<string | null>(null);
  const [justificarTipoId, setJustificarTipoId] = useState('');
  const [justificarFoto, setJustificarFoto] = useState<File | null>(null);
  const hoy = ymd(new Date());
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const nombreReal = user?.displayName || user?.email || 'RRHH celular';

  useEffect(() => {
    const sync = () => {
      const cola = movilWriteQueue.pending()[0] || movilCallableGate.pending()[0] || null;
      setPendingLabel(cola);
    };
    const offWrite = movilWriteQueue.subscribe(sync);
    const offCall = movilCallableGate.subscribe(sync);
    sync();
    return () => { offWrite(); offCall(); };
  }, []);

  useEffect(() => {
    if (!empresaId || !permitido) return;
    let cancel = false;
    const cargar = async () => {
      try {
        const scope = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
        const [lista, catalogo, empSnap] = await Promise.all([
          absenceService.getAll({ empresaId, scopeEmpresa: scope }),
          novedadTypeService.ensureSeeded(empresaId),
          getDocs(query(collection(db, 'empleados'), where('empresaId', '==', empresaId))),
        ]);
        if (cancel) return;
        const rows: AusenciaDia[] = lista.map((row) => ({
          id: String(row.id || ''),
          employeeId: row.employeeId,
          employeeName: row.employeeName || '',
          type: row.type || '',
          startDate: row.startDate || '',
          endDate: row.endDate || '',
          status: row.status || '',
          hasCertificate: row.hasCertificate,
          certificateUrl: row.certificateUrl,
          absenceType: String((row as { absenceType?: unknown }).absenceType || ''),
          shiftId: row.shiftId || null,
        }));
        const gente: Guardia[] = empSnap.docs
          .map((docSnap): Guardia | null => {
            const data = docSnap.data();
            const status = String(data.status || 'ACTIVE').toUpperCase();
            if (status === 'INACTIVE') return null;
            return {
              id: docSnap.id,
              nombre: `${data.lastName || ''} ${data.firstName || ''}`.trim() || String(data.nombre || 'Sin nombre'),
              telefono: String(data.phone || data.telefono || ''),
              preferredObjectiveId: String(data.preferredObjectiveId || ''),
            };
          })
          .filter((row): row is Guardia => row !== null);
        setAusencias(rows);
        setGuardias(gente);
        const activos = catalogo.filter((tipo) => tipo.status === 'ACTIVE').map((tipo) => ({
          id: String(tipo.id || tipo.label),
          label: tipo.label,
          code: tipo.code,
          defaultDays: tipo.defaultDays,
        }));
        setTipos(activos);
        setTipoId((actual) => actual || activos[0]?.id || '');
        try {
          sessionStorage.setItem(CACHE, JSON.stringify({ rows, gente }));
        } catch { /* caché llena */ }
      } catch {
        if (!navigator.onLine) {
          try {
            const raw = sessionStorage.getItem(CACHE);
            if (!raw) return;
            const saved = JSON.parse(raw) as { rows: AusenciaDia[]; gente: Guardia[] };
            setAusencias(saved.rows || []);
            setGuardias(saved.gente || []);
          } catch { /* sin caché */ }
        } else {
          toast.error('No se pudo leer el día.');
        }
      }
    };
    void cargar();
    return () => { cancel = true; };
  }, [empresaId, migracionCompleta, permitido]);

  const dia = useMemo(() => resumenDiaRrhh(hoy, ausencias), [hoy, ausencias]);
  const q = busqueda.trim().toLowerCase();
  const filtradas = guardias.filter((guardia) => !q || guardia.nombre.toLowerCase().includes(q)).slice(0, 8);
  const elegida = guardias.find((guardia) => guardia.id === elegidaId) || null;

  useEffect(() => {
    if (!elegidaId) return;
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() - ((desde.getDay() + 6) % 7));
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 6);
    hasta.setHours(23, 59, 59, 999);
    void getDocs(query(
      collection(db, 'turnos'),
      where('employeeId', '==', elegidaId),
      where('startTime', '>=', Timestamp.fromDate(desde)),
      where('startTime', '<=', Timestamp.fromDate(hasta)),
    )).then((snap) => {
      setTurnos(snap.docs.map((docSnap) => {
        const data = docSnap.data();
        const inicio = data.startTime?.toDate?.() as Date | undefined;
        return {
          id: docSnap.id,
          dia: inicio ? diaCorto(inicio) : '',
          codigo: String(data.code || data.type || ''),
        };
      }));
    }).catch(() => setTurnos([]));
  }, [elegidaId]);

  const abrirFicha = (id: string) => {
    setElegidaId(id);
    setFichaAbierta(true);
  };

  useEffect(() => { setFichaAbierta(false); }, [panelQuery]);

  const guardarAusencia = () => {
    const tipo = tipos.find((row) => row.id === tipoId);
    if (!elegida || !tipo || !empresaId) {
      toast.error('Elegí guardia y tipo.');
      return;
    }
    const cantidad = Math.max(1, Number(dias) || 1);
    const startDate = hoy;
    const endDate = endDateFromDefaultDays(startDate, cantidad) || startDate;
    const archivo = foto;
    const label = `Ausencia ${elegida.nombre}`;
    void enqueueFirestoreWrite(label, async () => {
      let certificateUrl: string | null = null;
      let certificateStoragePath: string | null = null;
      if (archivo) {
        certificateStoragePath = `absences/${empresaId}/${Date.now()}_${archivo.name.replace(/\s+/g, '_')}`;
        const fileRef = ref(storage, certificateStoragePath);
        await uploadBytes(fileRef, archivo);
        certificateUrl = await getDownloadURL(fileRef);
      }
      const status = absenceNeedsMedicalVerification({ type: tipo.label }) ? 'En verificación' as const : 'Autorizada' as const;
      const data: Absence = {
        employeeId: elegida.id,
        employeeName: elegida.nombre,
        type: tipo.label,
        startDate,
        endDate,
        status,
        hasCertificate: !!certificateUrl,
        certificateUrl,
        certificateName: archivo?.name || null,
        certificateStoragePath,
        reason: 'Carga rápida celular',
        comments: 'Cargado desde el celular',
      };
      (data as Absence & { absenceType: string }).absenceType = tipo.code;
      const docRef = await absenceService.add(data, empresaId);
      if (absenceReplicatesToPlanning(data)) {
        await replicarAusenciaPlanificador({
          empresaId,
          migracionCompleta,
          absenceId: docRef.id,
          data: { ...data, id: docRef.id },
          employees: [{ id: elegida.id, preferredObjectiveId: elegida.preferredObjectiveId }],
          objectives: [],
          notify: (message) => toast.error(message),
        });
        if (status === 'Autorizada') {
          await avisarNovedadDeAusencia({
            empresaId,
            ausenciaId: docRef.id,
            reportedBy: 'RRHH celular',
            data: { type: tipo.label, employeeId: elegida.id, employeeName: elegida.nombre, startDate, endDate },
          });
        }
      }
    }).then((result) => {
      toast[result === 'queued' ? 'message' : 'success'](result === 'queued' ? 'Pendiente de enviar' : 'Ausencia cargada. Los turnos quedan marcados.');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la ausencia.');
    });
  };

  const guardarNovedad = () => {
    if (!novedadTexto.trim() || !empresaId) {
      toast.error('Escribí la novedad.');
      return;
    }
    const texto = novedadTexto.trim();
    const label = `Novedad ${elegida?.nombre || novedadTipo}`;
    void enqueueFirestoreWrite(label, async () => {
      await crearNovedadRapida({
        empresaId,
        type: novedadTipo,
        title: novedadTipo,
        description: texto,
        employeeId: elegida?.id || null,
        employeeName: elegida?.nombre || '',
        reportedBy: 'RRHH celular',
      });
    }).then((result) => {
      if (result === 'sent') setNovedadTexto('');
      toast[result === 'queued' ? 'message' : 'success'](result === 'queued' ? 'Pendiente de enviar' : 'Novedad cargada');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la novedad.');
    });
  };

  const tiposJustificar = useMemo(() => {
    const delCatalogo = tiposParaJustificar(tipos);
    return delCatalogo.length ? delCatalogo : TIPOS_JUSTIFICAR_DEFAULT;
  }, [tipos]);
  const ausenciaAJustificar = justificarId ? ausencias.find((row) => row.id === justificarId) || null : null;

  const abrirJustificar = (ausenciaId: string) => {
    setJustificarId(ausenciaId);
    setJustificarTipoId(tiposJustificar[0]?.id || '');
    setJustificarFoto(null);
  };
  const cerrarJustificar = () => {
    setJustificarId(null);
    setJustificarFoto(null);
  };

  /** Misma edición que el escritorio: `absenceService.update` + réplica en planificación + aviso. */
  const justificarAusencia = () => {
    const tipo = tiposJustificar.find((row) => row.id === justificarTipoId) || tiposJustificar[0];
    const ausencia = ausenciaAJustificar;
    if (!ausencia || !tipo || !empresaId) {
      toast.error('Elegí el tipo.');
      return;
    }
    const archivo = justificarFoto;
    const label = `Justificar ${ausencia.employeeName}`;
    void enqueueFirestoreWrite(label, async () => {
      let certificateUrl: string | null = null;
      let certificateStoragePath: string | null = null;
      if (archivo) {
        certificateStoragePath = `absences/${empresaId}/${Date.now()}_${archivo.name.replace(/\s+/g, '_')}`;
        const fileRef = ref(storage, certificateStoragePath);
        await uploadBytes(fileRef, archivo);
        certificateUrl = await getDownloadURL(fileRef);
      }
      const patch = patchJustificarAusencia({
        tipo,
        tieneCertificado: !!certificateUrl || !!ausencia.certificateUrl,
        requiereVerificacionMedica: absenceNeedsMedicalVerification({ type: tipo.label }),
        nombreReal,
      });
      const certificado = certificateUrl ? { certificateUrl, certificateName: archivo?.name || null, certificateStoragePath } : {};
      const eraAviso = ausencia.type === 'Ausencia con aviso' || ausencia.status === 'Avisada';
      const cambios = {
        ...patch,
        ...certificado,
        revisionEstado: patch.status === 'En verificación' ? 'POR_REVISAR' : 'JUSTIFICADA',
        ...(eraAviso ? { avisoPortal: true } : {}),
        historial: arrayUnion({
          texto: patch.status === 'En verificación' ? 'Certificado en verificación' : `Justificada (${tipo.label})`,
          por: nombreReal,
          at: new Date().toISOString(),
        }),
      } as Partial<Absence> & { absenceType: string };
      const dataToSave: Absence & { absenceType: string } = {
        employeeId: ausencia.employeeId || '',
        employeeName: ausencia.employeeName,
        startDate: ausencia.startDate,
        endDate: ausencia.endDate,
        reason: '',
        ...(ausencia.shiftId ? { shiftId: ausencia.shiftId } : {}),
        type: patch.type,
        absenceType: patch.absenceType,
        status: patch.status,
        hasCertificate: patch.hasCertificate,
        comments: patch.comments,
        ...certificado,
      };
      await absenceService.update(ausencia.id, cambios, { empresaId, migracionCompleta });
      if (absenceReplicatesToPlanning(dataToSave)) {
        const guardia = guardias.find((row) => row.id === ausencia.employeeId);
        await replicarAusenciaPlanificador({
          empresaId,
          migracionCompleta,
          absenceId: ausencia.id,
          data: { ...dataToSave, id: ausencia.id },
          employees: [{ id: ausencia.employeeId || '', preferredObjectiveId: guardia?.preferredObjectiveId }],
          objectives: [],
          notify: (message) => toast.error(message),
        });
        if (dataToSave.status === 'Justificada') {
          await avisarNovedadDeAusencia({
            empresaId,
            ausenciaId: ausencia.id,
            reportedBy: nombreReal,
            data: { type: tipo.label, employeeId: ausencia.employeeId || '', employeeName: ausencia.employeeName, startDate: ausencia.startDate, endDate: ausencia.endDate },
          });
        }
      }
      setAusencias((prev) => prev.map((row) => (row.id === ausencia.id
        ? { ...row, type: patch.type, absenceType: patch.absenceType, status: patch.status, hasCertificate: patch.hasCertificate, certificateUrl: certificateUrl || row.certificateUrl }
        : row)));
    }).then((result) => {
      toast[result === 'queued' ? 'message' : 'success'](result === 'queued' ? 'Pendiente de enviar' : `Ausencia justificada como ${tipo.label}.`);
      cerrarJustificar();
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo justificar.');
    });
  };

  if (!permitido) {
    return <p className="p-6 text-sm font-semibold text-slate-600">No tenés permiso de RRHH.</p>;
  }

  return (
    <>
      <RrhhScreens
        empresa={empresa?.name || 'Empresa'}
        onEmpresa={empresaSheet.onEmpresa}
        online={online}
        pendingLabel={pendingLabel}
        panel={panel}
        hoyLabel={diaLargo(new Date())}
        ausenciasHoy={dia.ausenciasHoy.map((row) => ({
          id: row.id,
          employeeId: row.employeeId || '',
          nombre: row.employeeName,
          tipo: row.type,
          justificable: esAusenciaInjustificada(row),
        }))}
        licencias={dia.licencias.map((row) => ({
          id: row.id,
          employeeId: row.employeeId || '',
          nombre: row.employeeName,
          detalle: row.startDate === hoy ? 'Empieza' : 'Termina',
        }))}
        certificados={dia.certificados.map((row) => ({
          id: row.id,
          employeeId: row.employeeId || '',
          nombre: row.employeeName,
        }))}
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        guardias={filtradas}
        tipos={tipos}
        tipoId={tipoId}
        onTipo={setTipoId}
        dias={dias}
        onDias={setDias}
        fotoNombre={foto?.name || null}
        onFoto={setFoto}
        onGuardarAusencia={guardarAusencia}
        novedadTipo={novedadTipo}
        onNovedadTipo={setNovedadTipo}
        novedadTexto={novedadTexto}
        onNovedadTexto={setNovedadTexto}
        onGuardarNovedad={guardarNovedad}
        ficha={elegida ? { nombre: elegida.nombre, telefono: elegida.telefono, turnos } : null}
        onElegir={setElegidaId}
        onFicha={abrirFicha}
        onPanel={setPanel}
        onJustificar={abrirJustificar}
        justificar={ausenciaAJustificar ? {
          id: ausenciaAJustificar.id,
          nombre: `${ausenciaAJustificar.employeeName} · ${ausenciaAJustificar.type}`,
          tipos: tiposJustificar,
          tipoId: justificarTipoId,
          fotoNombre: justificarFoto?.name || null,
        } : null}
        onJustificarTipo={setJustificarTipoId}
        onJustificarFoto={setJustificarFoto}
        onJustificarGuardar={justificarAusencia}
        onJustificarCerrar={cerrarJustificar}
      />
      {empresaSheet.sheet}
      <MovilBottomNav />
    </>
  );
}
