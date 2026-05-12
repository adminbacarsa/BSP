const fs = require('fs');
const path = require('path');

// ==========================================
// 🕵️ CRONO: MAPA DE ESTRUCTURA REAL
// ==========================================
const ROOT_DIR = process.cwd();
const TARGETS = ['function', 'web2']; 

console.log(`\n📡 CRONO: Escaneando estructura profunda en ${ROOT_DIR}...\n`);

// Archivos "Ancla" que nos dicen qué es cada carpeta
const ANCHORS = [
    'dashboard.tsx', 'dashboard.js', 'page.tsx', // Frontend
    'app.module.ts', 'main.ts', 'index.ts',      // Backend
    'package.json'
];

function scanDir(dir, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return;
    if (!fs.existsSync(dir)) return;

    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        // Ordenar: Carpetas primero
        items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? 0 : a.isDirectory() ? -1 : 1));

        for (const item of items) {
            // Ignorar basura
            if (['node_modules', '.git', '.next', '.firebase', 'dist', 'build', 'coverage', '.vscode', 'public', '.turbo'].includes(item.name)) continue;

            const isDir = item.isDirectory();
            const prefix = '   '.repeat(depth) + (depth === 0 ? '📦 ' : '├── ');
            const icon = isDir ? '📂' : '📄';
            
            // Mostrar carpetas o archivos ancla
            if (isDir || ANCHORS.includes(item.name)) {
                console.log(`${prefix}${icon} ${item.name}`);
            }

            if (isDir) {
                scanDir(path.join(dir, item.name), depth + 1, maxDepth);
            }
        }
    } catch (e) {
        console.log(`   ⛔ Error de acceso: ${dir}`);
    }
}

// EJECUCIÓN
TARGETS.forEach(target => {
    const fullPath = path.join(ROOT_DIR, target);
    console.log(`\n=============================================`);
    console.log(` RASTREANDO: ${target.toUpperCase()}`);
    console.log(`=============================================`);
    
    if (fs.existsSync(fullPath)) {
        scanDir(fullPath);
    } else {
        console.log(`❌ La carpeta '${target}' no existe.`);
    }
});
console.log('\n=============================================');