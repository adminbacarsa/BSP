const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
const OUTPUT_FILE = 'contexto_plataforma.txt';

// 1. CARPETAS PROHIBIDAS (Basura, compilados, librerías)
const BLACKLIST_DIRS = [
    'node_modules',
    '.git',
    '.next',       // Build de Next.js
    '.firebase',   // Emuladores/Build de Firebase
    'dist',        // Build de NestJS/TS
    'build',       // Build genérico
    'out',         // Export estático
    'coverage',    // Reportes de test
    '.vscode',
    '.idea',
    'public',      // Assets estáticos (imágenes, fuentes)
    'assets',
    'images'
];

// 2. EXTENSIONES PERMITIDAS (Solo código real)
const ALLOWED_EXTS = [
    '.ts', '.tsx',  // TypeScript
    '.js', '.jsx',  // JavaScript
    '.css', '.scss', // Estilos
    '.json',        // Configuración
    '.env'          // Variables de entorno (OJO: Revisa que no haya claves privadas)
];

// 3. ARCHIVOS DE CONFIGURACIÓN CLAVE (Se incluyen aunque estén en la raíz)
const CONFIG_FILES = [
    'package.json',
    'tsconfig.json',
    'next.config.js',
    'next.config.ts',
    'tailwind.config.js',
    'tailwind.config.ts',
    'postcss.config.js',
    '.eslintrc.json',
    'firebase.json',
    '.firebaserc'
];

// 4. ARCHIVOS A IGNORAR ESPECÍFICAMENTE (Locks y logs)
const IGNORE_FILES = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'npm-debug.log'
];

function shouldScanDirectory(dirName) {
    return !BLACKLIST_DIRS.includes(dirName);
}

function shouldIncludeFile(fileName) {
    // Si es un archivo bloqueado explícitamente, adiós
    if (IGNORE_FILES.includes(fileName)) return false;

    // Si es un archivo de configuración clave, adentro
    if (CONFIG_FILES.includes(fileName)) return true;

    // Si tiene extensión de código, adentro
    const ext = path.extname(fileName).toLowerCase();
    return ALLOWED_EXTS.includes(ext);
}

function scanDirectory(dir, fileList = []) {
    let files = [];
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        return fileList;
    }

    files.forEach(file => {
        const filePath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch (e) { return; }

        if (stat.isDirectory()) {
            if (shouldScanDirectory(file)) {
                scanDirectory(filePath, fileList);
            }
        } else {
            if (shouldIncludeFile(file)) {
                // Filtro adicional: Evitar archivos minificados gigantes
                if (stat.size < 500 * 1024) { // Menos de 500KB
                    fileList.push(filePath);
                }
            }
        }
    });

    return fileList;
}

function generateContext() {
    console.log("🛡️  Iniciando escaneo de código fuente (PLATAFORMA PURA)...");
    const rootDir = process.cwd();
    
    try {
        const allFiles = scanDirectory(rootDir);
        
        // Filtro final de seguridad: Asegurar que NO haya nada con rutas de 'node_modules' o '.next' que se haya colado
        const cleanFiles = allFiles.filter(f => 
            !f.includes('node_modules') && 
            !f.includes('.next') && 
            !f.includes(path.sep + 'dist' + path.sep)
        );

        let output = `CONTEXTO PLATAFORMA: ${new Date().toISOString()}\n`;
        output += `ARCHIVOS FUENTE: ${cleanFiles.length}\n\n`;

        console.log(`✅ Encontrados ${cleanFiles.length} archivos de código.`);

        cleanFiles.forEach(filePath => {
            const relativePath = path.relative(rootDir, filePath);
            
            output += `================================================================================\n`;
            output += `FILE: ${relativePath}\n`;
            output += `================================================================================\n`;
            
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                output += content + '\n\n';
            } catch (err) {
                output += `[ERROR LECTURA]\n\n`;
            }
        });

        fs.writeFileSync(OUTPUT_FILE, output);
        console.log(`📦 Archivo generado: ${OUTPUT_FILE}`);
        console.log(`   (Este archivo contiene SOLO el código que tú escribiste y configuraciones, nada de compilados).`);

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

generateContext();