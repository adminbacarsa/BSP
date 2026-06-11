import * as admin from 'firebase-admin';

/**
 * Cuenta las llegadas tarde del mes para un empleado.
 * Si llega a 3, crea una novedad LLEGADA_TARDE_REITERADA en RRHH.
 * Llamada desde onTurnoWrite cuando una ausencia AA se convierte a "Llegada Tarde".
 */
export async function checkLlegadaTardeReiterada(
  db: admin.firestore.Firestore,
  employeeId: string,
  employeeName: string,
  empresaId: string | null,
  absenceDate: string, // YYYY-MM-DD
): Promise<void> {
  if (!employeeId || !absenceDate) return;

  const parts = absenceDate.split('-');
  const year = parts[0];
  const month = parts[1];
  if (!year || !month) return;

  const monthStart = `${year}-${month}-01`;
  const monthEnd = `${year}-${month}-31`; // string compare cubre todos los meses

  // Contar llegadas tarde del mes para este empleado
  const snap = await db.collection('ausencias')
    .where('employeeId', '==', employeeId)
    .where('type', '==', 'Llegada Tarde')
    .where('startDate', '>=', monthStart)
    .where('startDate', '<=', monthEnd)
    .get();

  const count = snap.size;
  console.log(`[checkLlegadaTardeReiterada] ${employeeName}: ${count} tardanzas en ${year}-${month}`);

  if (count === 3) {
    const now = admin.firestore.Timestamp.now();

    // Evitar duplicar la novedad para el mismo mes/empleado
    const existingSnap = await db.collection('novedades')
      .where('type', '==', 'LLEGADA_TARDE_REITERADA')
      .where('employeeId', '==', employeeId)
      .where('month', '==', `${year}-${month}`)
      .limit(1)
      .get();

    if (!existingSnap.empty) return;

    await db.collection('novedades').add({
      type: 'LLEGADA_TARDE_REITERADA',
      title: '3ra llegada tarde en el mes',
      description: `${employeeName || 'Empleado'} acumula 3 llegadas tarde en ${month}/${year}`,
      status: 'pending',
      employeeId,
      employeeName: employeeName || '',
      empresaId: empresaId || null,
      month: `${year}-${month}`,
      tardanzaCount: count,
      urgency: 'MEDIUM',
      handledBy: 'RRHH',
      createdAt: now,
      source: 'SISTEMA',
      reportedBy: 'SISTEMA',
    });

    console.log(`[checkLlegadaTardeReiterada] Novedad creada para ${employeeName}`);
  }
}
