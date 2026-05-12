const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ==========================================
// ⚙️ CRONOAPP SNAPSHOT MANAGER V8.0 (SMART)
// ==========================================
const ROOT_DIR = process.cwd();
const BACKUP_ROOT = path.join(ROOT_DIR, '_SNAPSHOTS_ROOT');

// 1. DETECCIÓN DE RUTAS RAÍZ (NO SE INVENTA NADA)
const PATHS = {
    ROOT: ROOT_DIR,
    BACKEND: fs.existsSync(path.join(ROOT_DIR, 'apps', 'functions')) ? path.join(ROOT_DIR, 'apps', 'functions') : null,
    FRONTEND: fs.existsSync(path.join(ROOT_DIR, 'apps', 'web2')) ? path.join(ROOT_DIR, 'apps', 'web2') : null
};

// 2. DETECCIÓN DINÁMICA DE 'SRC'
// El script busca si existe 'src' para construir las rutas correctamente
let FE_SRC = '';
if (PATHS.FRONTEND) {
    if (fs.existsSync(path.join(PATHS.FRONTEND, 'src'))) {
        FE_SRC = path.join(PATHS.FRONTEND, 'src');
    } else {
        FE_SRC = PATHS.FRONTEND; // Fallback por si acaso
    }
}

// 🛑 LISTA NEGRA (Archivos Ignorados)
const IGNORE_LIST = [
    'node_modules', '.next', 'out', '.git', '.firebase', 
    '_SNAPSHOTS_ROOT', '.DS_Store', 'dist', 'build', 'lib', 
    'coverage', '.turbo', '.vscode', 'package-lock.json', 'yarn.lock',
    'firebase-debug.log', 'ui-debug.log', 'Thumbs.db'
];

if (!fs.existsSync(BACKUP_ROOT)) fs.mkdirSync(BACKUP_ROOT);

// ==========================================
// 🧠 MOTOR DE DEPENDENCIAS INTELIGENTE
// ==========================================

/**
 * Escanea el proyecto para encontrar todas las piezas dispersas de un módulo.
 * Estrategia: "Safe Context" -> Página + Componentes + Lógica Global
 */
function resolveModuleDependencies(moduleName) {
    if (!PATHS.FRONTEND || !FE_SRC) return [];

    const pathsToBackup = [];
    const searchName = moduleName.toLowerCase();

    // A. LA VISTA PRINCIPAL (Page)
    // Ruta calculada: apps/web2/src/pages/admin/[nombre_real]
    // Buscamos la carpeta exacta en pages/admin
    const pagesAdmin = path.join(FE_SRC, 'pages', 'admin');
    if (fs.existsSync(pagesAdmin)) {
        // Buscamos el nombre exacto de la carpeta (case sensitive en algunos OS)
        const found = fs.readdirSync(pagesAdmin).find(f => f.toLowerCase() === searchName);
        if (found) {
            pathsToBackup.push({ 
                path: path.join(pagesAdmin, found), 
                desc: `📄 VISTA: pages/admin/${found}` 
            });
        }
    }

    // B. COMPONENTES RELACIONADOS (UI)
    // Buscamos en components/ cualquier carpeta que contenga el nombre del módulo
    const compRoot = path.join(FE_SRC, 'components');
    if (fs.existsSync(compRoot)) {
        const comps = fs.readdirSync(compRoot, { withFileTypes: true });
        comps.forEach(c => {
            if (c.isDirectory()) {
                const cName = c.name.toLowerCase();
                // Heurística: Si el nombre del componente contiene el nombre del módulo (ej: "operaciones" contiene "oper")
                // O viceversa, o coincidencia parcial de 4 letras para cruzar inglés/español
                if (cName.includes(searchName) || searchName.includes(cName) || 
                   (searchName.length > 4 && cName.includes(searchName.substring(0,4)))) {
                    pathsToBackup.push({ 
                        path: path.join(compRoot, c.name), 
                        desc: `🧩 UI: components/${c.name}` 
                    });
                }
            }
        });
    }

    // C. CONTEXTO GLOBAL (DEPENDENCIAS CRÍTICAS)
    // Para asegurar que el módulo funcione, respaldamos SIEMPRE los hooks y servicios.
    // Son livianos y evitan errores de "Module not found".
    ['hooks', 'services', 'utils', 'context', 'types', 'interfaces', 'lib'].forEach(shared => {
        const sharedPath = path.join(FE_SRC, shared);
        if (fs.existsSync(sharedPath)) {
            pathsToBackup.push({ 
                path: sharedPath, 
                desc: `🔗 GLOBAL: src/${shared}` 
            });
        }
    });

    return pathsToBackup;
}

// ==========================================
// 🛠️ FUNCIONES DE SISTEMA
// ==========================================

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return 0;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    
    let count = 0;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORE_LIST.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        try {
            if (entry.isDirectory()) {
                count += copyRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
                count++;
            }
        } catch (err) {}
    }
    return count;
}

function clearDirectory(targetDir) {
    if (!fs.existsSync(targetDir)) return;
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORE_LIST.includes(entry.name) || 
            entry.name === 'snapshot.js' || 
            entry.name === 'CONTEXTO_CRONOAPP.txt') continue;
        
        const fullPath = path.join(targetDir, entry.name);
        try {
            if (entry.isDirectory()) {
                fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(fullPath);
            }
        } catch (e) { console.error(`⚠️ Error al limpiar: ${entry.name}`); }
    }
}

// ==========================================
// 🚀 EJECUCIÓN
// ==========================================

const createBackup = (description, type, moduleName = null) => {
    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const safeDesc = description.replace(/[^a-z0-9]/gi, '_');
    
    let folderName = '';
    let backupTargets = []; // { path, desc, relativeDest }

    // --- CONFIGURACIÓN ---
    if (type === 'FULL') {
        folderName = `[FULL]_${timestamp}__${safeDesc}`;
        backupTargets.push({ path: ROOT_DIR, desc: '🌎 Todo el Proyecto', relativeDest: '' });
    } 
    else if (type === 'BACKEND') {
        if (!PATHS.BACKEND) return console.error('❌ Backend no encontrado.');
        folderName = `[BACKEND]_${timestamp}__${safeDesc}`;
        backupTargets.push({ path: PATHS.BACKEND, desc: '⚙️ Backend', relativeDest: 'apps/functions' });
    } 
    else if (type === 'FRONTEND') {
        if (!PATHS.FRONTEND) return console.error('❌ Frontend no encontrado.');
        folderName = `[FRONTEND]_${timestamp}__${safeDesc}`;
        backupTargets.push({ path: PATHS.FRONTEND, desc: '🖥️ Frontend', relativeDest: 'apps/web2' });
    }
    else if (type === 'MODULE') {
        folderName = `[MOD_${moduleName.toUpperCase()}]_${timestamp}__${safeDesc}`;
        const targets = resolveModuleDependencies(moduleName);
        
        if (targets.length === 0) return console.error(`❌ No se encontró nada para: ${moduleName}`);

        console.log(`\n🔍 Mapeo Inteligente para ${moduleName}:`);
        targets.forEach(t => {
            const relPath = path.relative(ROOT_DIR, t.path);
            backupTargets.push({ path: t.path, desc: t.desc, relativeDest: relPath });
            console.log(`   + ${t.desc}`);
        });
    }

    // --- PROCESO ---
    const finalBackupPath = path.join(BACKUP_ROOT, folderName);
    console.log(`\n📦 Guardando en: ${folderName}...`);

    try {
        let filesCount = 0;
        backupTargets.forEach(target => {
            const dest = path.join(finalBackupPath, target.relativeDest);
            filesCount += copyRecursive(target.path, dest);
        });

        // Siempre copiar el contexto
        ['package.json', 'CONTEXTO_CRONOAPP.txt'].forEach(f => {
            const fSrc = path.join(ROOT_DIR, f);
            if (fs.existsSync(fSrc)) fs.copyFileSync(fSrc, path.join(finalBackupPath, f));
        });

        console.log(`✅ ¡Backup Exitoso! (~${filesCount} archivos)`);
    } catch (e) {
        console.error(`❌ Error crítico: ${e.message}`);
    }
};

const restoreBackupInteract = (rl) => {
    const backups = fs.readdirSync(BACKUP_ROOT)
        .filter(f => fs.statSync(path.join(BACKUP_ROOT, f)).isDirectory())
        .sort().reverse();

    if (backups.length === 0) { console.log('❌ Sin snapshots.'); rl.close(); return; }

    console.log('\n📂 SNAPSHOTS DISPONIBLES:');
    backups.forEach((b, i) => console.log(`   [${i + 1}] ${b}`));
    console.log('   [0] Cancelar');

    rl.question('\n👉 Número: ', (answer) => {
        const idx = parseInt(answer) - 1;
        if (answer === '0' || isNaN(idx) || idx < 0 || idx >= backups.length) { rl.close(); return; }

        const selectedBackup = backups[idx];
        const sourcePath = path.join(BACKUP_ROOT, selectedBackup);
        
        console.log(`\n⚠️  RESTAURANDO...`);
        // Copia manteniendo la estructura relativa
        copyRecursive(sourcePath, ROOT_DIR);
        console.log(`✅ Restauración completada.`);
        rl.close();
    });
};

// ==========================================
// 🎮 MENÚ DINÁMICO
// ==========================================

// Escaneo de Módulos Reales
let availableModules = [];
if (FE_SRC) {
    const adminPath = path.join(FE_SRC, 'pages', 'admin');
    if (fs.existsSync(adminPath)) {
        availableModules = fs.readdirSync(adminPath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
    }
}

const args = process.argv.slice(2);
if (args[0] === 'auto') {
    createBackup('auto', 'FULL');
} else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    console.log(`
    =========================================
    🛡️  CRONOAPP SNAPSHOT V8.0 (SMART)
    =========================================
    1. 🌎 PROYECTO COMPLETO
    2. ⚙️  SOLO BACKEND
    3. 🖥️  SOLO FRONTEND
    
    --- MÓDULOS DETECTADOS ---`);
    
    if (availableModules.length > 0) {
        availableModules.forEach((mod, i) => console.log(`    ${i + 4}. 📦 ${mod.toUpperCase()}`));
    } else {
        console.log(`    (No se detectaron módulos en ${FE_SRC})`);
    }

    console.log(`\n    99. ♻️  RESTAURAR`);
    console.log(`    0. Salir`);
    console.log(`    =========================================`);

    rl.question('Opción: ', (opt) => {
        const n = parseInt(opt);
        if (opt === '1') createBackup('manual', 'FULL');
        else if (opt === '2') createBackup('manual', 'BACKEND');
        else if (opt === '3') createBackup('manual', 'FRONTEND');
        else if (opt === '99') restoreBackupInteract(rl);
        else if (n >= 4 && n < 4 + availableModules.length) {
            const modName = availableModules[n - 4];
            rl.question(`Etiqueta para ${modName}: `, (d) => {
                createBackup(d || 'mod', 'MODULE', modName);
                rl.close();
            });
        } else rl.close();
    });
}