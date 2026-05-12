const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // ⚠️ OJO AQUÍ

// Inicializar
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const email = 'admin@bacar.com'; // 📧 TU EMAIL DE ADMIN
const password = 'password123'; // 🔒 TU CONTRASEÑA

async function createSuperAdmin() {
  try {
    // 1. Crear usuario
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: 'Super Admin',
      emailVerified: true,
    });

    console.log('Usuario creado:', userRecord.uid);

    // 2. Asignar Custom Claim 'admin'
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'admin' });
    console.log('Rol de ADMIN asignado exitosamente.');

    // 3. Crear perfil en Firestore (Opcional, para que no falle la UI)
    await admin.firestore().collection('empleados').doc(userRecord.uid).set({
        uid: userRecord.uid,
        name: 'Super Admin',
        email: email,
        role: 'admin',
        isAvailable: true
    });
    console.log('Perfil en Firestore creado.');

  } catch (error) {
    console.error('Error:', error);
  }
}

createSuperAdmin();



