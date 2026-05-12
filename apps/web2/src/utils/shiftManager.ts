
import { db } from '../services/firebase-client.service';
import { collection, addDoc } from 'firebase/firestore';

export const procesarAsignacionTurno = async ({ adminUid, newTurnoData, existingTurnos, ausencias, fechaReferencia }, force = false) => {
  try {
    await addDoc(collection(db, 'turnos'), newTurnoData);
    return { success: true };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
};
