import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBJaTiMekwbGPXAm-mkPl_u6KEWCSpvfic",
  authDomain: "comtroldata.firebaseapp.com",
  projectId: "comtroldata",
  storageBucket: "comtroldata.firebasestorage.app",
  messagingSenderId: "698108879063",
  appId: "1:698108879063:web:ab30eb8b80a774f52f1092",
  measurementId: "G-SWCD6XEWDH"
};

console.log('\n🕵️ INICIANDO ESPIONAJE DE ESTRUCTURA');
console.log('====================================');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const run = async () => {
    try {
        console.log("⏳ Descargando Clientes...");
        const clientsSnap = await getDocs(collection(db, 'clients'));
        
        if (clientsSnap.empty) {
            console.log("❌ LA COLECCIÓN 'clients' ESTÁ VACÍA.");
            return;
        }

        console.log(`✅ ${clientsSnap.size} Clientes encontrados. Imprimiendo el primero para análisis...\n`);

        // Tomamos el primer cliente que tenga datos para analizar
        const doc = clientsSnap.docs[0];
        const data = doc.data();

        console.log(`📂 ID CLIENTE: ${doc.id}`);
        console.log(`📂 NOMBRE: ${data.name || 'Sin Nombre'}`);
        
        console.log("\n--- ESTRUCTURA CRUDA (JSON) ---");
        // Imprimimos el JSON completo para ver las propiedades reales
        console.log(JSON.stringify(data, null, 2));
        console.log("-------------------------------\n");

        // Verificamos campos sospechosos
        console.log("🔎 ANÁLISIS RÁPIDO:");
        console.log(`   - ¿Tiene 'structure'? ${data.structure ? 'SÍ (' + data.structure.length + ')' : 'NO'}`);
        console.log(`   - ¿Tiene 'puestos'? ${data.puestos ? 'SÍ (' + data.puestos.length + ')' : 'NO'}`);
        console.log(`   - ¿Tiene 'objetivos'? ${data.objetivos ? 'SÍ (' + data.objetivos.length + ')' : 'NO'}`);

        if (data.objetivos && data.objetivos.length > 0) {
            console.log("\n🔎 DENTRO DEL PRIMER OBJETIVO:");
            console.log(JSON.stringify(data.objetivos[0], null, 2));
        }

    } catch (e) {
        console.error("❌ ERROR:", e);
    } finally {
        process.exit();
    }
};

run();