const fs = require('fs');
const path = require('path');

console.log("🕵️ ESCANEANDO PROYECTO PARA DETECTAR CONEXIONES A FIREBASE...");
console.log("============================================================");

const ROOT_DIR = path.join(process.cwd(), 'apps', 'web2', 'src');

function scanDirectory(directory) {
    if (!fs.existsSync(directory)) return;

    const files = fs.readdirSync(directory);

    files.forEach(file => {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.js')) {
            checkFile(fullPath);
        }
    });
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    // Buscamos patrones como: collection(db, 'nombre') o collection(db, "nombre")
    const regex = /collection\(db,\s*['"]([^'"]+)['"]\)/g;
    
    let match;
    while ((match = regex.exec(content)) !== null) {
        const collectionName = match[1];
        const relativePath = path.relative(process.cwd(), filePath);
        
        // Filtramos colecciones comunes para resaltar las conflictivas
        let color = "\x1b[37m"; // Blanco
        if (collectionName === 'audit_logs' || collectionName === 'audits') color = "\x1b[31m"; // ROJO (Conflictivo)
        if (collectionName === 'historial_operaciones') color = "\x1b[32m"; // VERDE (Correcto según Smart)
        if (collectionName === 'novedades') color = "\x1b[33m"; // AMARILLO
        if (collectionName === 'ausencias') color = "\x1b[33m"; // AMARILLO
        
        console.log(`${color}[${collectionName.padEnd(25)}] \x1b[0m -> ${relativePath}`);
    }
}

try {
    scanDirectory(ROOT_DIR);
    console.log("\n============================================================");
    console.log("✅ Escaneo finalizado. Revisa las líneas ROJAS.");
} catch (e) {
    console.error("Error escaneando:", e);
}