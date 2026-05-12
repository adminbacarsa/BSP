
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase-client.service';

export const AuditActions = {
  OVERRIDE_SHIFT_LIMIT: 'FORZAR_LIMITE_HORAS',
  OVERRIDE_FRANCO: 'FORZAR_FRANCO',
  SHIFT_CREATED: 'TURNO_CREADO',
  SHIFT_DELETED: 'TURNO_ELIMINADO'
};

export const logAudit = async (adminUid, action, details) => {
  try {
    await addDoc(collection(db, 'auditorias'), {
      adminUid,
      action,
      details,
      timestamp: serverTimestamp(),
      userAgent: navigator.userAgent
    });
    console.log('📝 Auditoría registrada:', action);
  } catch (error) {
    console.error('❌ Error registrando auditoría:', error);
  }
};
