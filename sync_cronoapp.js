const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN DE LA OFICINA VIRTUAL ---
const PROJECT_ROOT = process.cwd(); 

// RUTA DESTINO (Unidad H:)
const OUTPUT_DIR = 'H:\\Mi unidad\\CronoApp_IA'; 

const FILES = {
    HTML: path.join(OUTPUT_DIR, 'Dashboard_CronoApp.html'),
    TXT:  path.join(OUTPUT_DIR, 'CONTEXTO_CRONOAPP.txt')
};

// --- FILTROS DE LIMPIEZA ---
const IGNORE_EXACT = ['node_modules', '.git', '.next', 'out', '.firebase', '.vscode', 'dist', 'build', 'coverage', 'assets', 'public', 'images', 'obj', 'bin'];
const IGNORE_CONTAINS = ['snapshot', 'backup', 'copia', 'old', 'test', 'respaldo'];
const ALLOWED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.env'];

// --- DICCIONARIO EXPERTO (Lógica de Negocio Real) ---
const DESCRIPCIONES_EXPERTAS = {
    // BACKEND
    'auth.service.ts': "🔥 Auth: Crea usuarios en Firebase y sincroniza perfil empleados (Claims/Roles).",
    'scheduling.service.ts': "📅 Core: Motor de asignación de turnos. Valida conflictos y licencias.",
    'workload.service.ts': "💰 CCT: Calcula horas normales, nocturnas y extras (50/100) según convenio.",
    'audit.service.ts': "📍 Geo: Juez de fichadas. Valida distancia (100m) y fuerza mayor.",
    'pattern.service.ts': "🔄 Vacantes: Generador masivo de turnos vacíos según reglas.",
    'shift-overlap.service.ts': "🧮 Utils: Matemática para detectar cruces de horarios.",
    
    // FRONTEND
    'dashboard.tsx': "📊 KPI: Tablero principal (Cobertura, Vacantes, Asistencia).",
    'scheduler.tsx': "🗓️ Grilla: Calendario interactivo con Drag & Drop y Zoom.",
    'operaciones/index.tsx': "✈️ Monitor: Tablero 'Aeropuerto' (Entradas/Salidas/Alertas).",
    'OperacionesMap.tsx': "🗺️ Mapa: Visualización en vivo con pines de estado (Leaflet/Maps).",
    'reportes/index.tsx': "💵 Sueldos: Liquidador. Cruza fichadas con feriados y convenio.",
    'useOperacionesMonitor.ts': "🧠 Hook: Lógica del monitor (Calcula estados Tarde/En Curso)."
};

// --- LÓGICA DE INTELIGENCIA ---
function obtenerDescripcion(nombre, contenido) {
    // 1. Buscamos en el diccionario experto
    const keys = Object.keys(DESCRIPCIONES_EXPERTAS);
    for (const key of keys) {
        if (nombre.endsWith(key)) return "⭐ " + DESCRIPCIONES_EXPERTAS[key];
    }

    // 2. Deducción genérica
    const n = nombre.toLowerCase();
    if (n.includes('.controller.')) return "🔌 API Endpoint";
    if (n.includes('.service.')) return "🧠 Lógica de Negocio";
    if (n.includes('.module.')) return "📦 Módulo NestJS";
    if (n.includes('.entity.') || n.includes('.schema.')) return "🗄️ Modelo DB";
    if (n.includes('.dto.')) return "📋 DTO Transferencia";
    
    if (n.includes('page') || n === 'index.tsx') return "🖥️ Página / Vista";
    if (n.includes('layout')) return "📐 Layout Base";
    if (n.includes('context')) return "🌐 Contexto Global";
    if (n.startsWith('use')) return "🪝 React Hook";
    if (n.includes('.css')) return "🎨 Estilos";
    
    if (n.includes('config') || n.endsWith('.json')) return "⚙️ Configuración";
    
    return "📄 Código Fuente";
}

// --- ESCANER ---
function escanear(dir) {
    let resultados = [];
    let items = [];
    try { items = fs.readdirSync(dir); } catch (e) { return []; }

    items.forEach(item => {
        const fullPath = path.join(dir, item);
        if (debeIgnorar(fullPath)) return;

        let stat;
        try { stat = fs.statSync(fullPath); } catch(e) { return; }

        if (stat.isDirectory()) {
            resultados = resultados.concat(escanear(fullPath));
        } else {
            const ext = path.extname(item).toLowerCase();
            if (ALLOWED_EXTS.includes(ext) && stat.size < 800 * 1024) {
                const relPath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');
                let area = 'OTROS';
                if (relPath.includes('functions') || relPath.includes('backend')) area = 'BACKEND';
                else if (relPath.includes('web') || relPath.includes('frontend')) area = 'FRONTEND';
                else if (relPath.includes('config') || item.endsWith('json')) area = 'CONFIG';

                const folder = path.basename(path.dirname(fullPath)).toUpperCase();
                const content = fs.readFileSync(fullPath, 'utf8');
                const desc = obtenerDescripcion(item, content);

                resultados.push({ name: item, path: relPath, area, folder, content, desc });
            }
        }
    });
    return resultados;
}

function debeIgnorar(ruta) {
    const nombre = path.basename(ruta).toLowerCase();
    const rutaLower = ruta.toLowerCase();
    if (IGNORE_EXACT.includes(nombre)) return true;
    for (const word of IGNORE_CONTAINS) if (rutaLower.includes(word)) return true;
    return false;
}

// --- GENERADORES ---
function generarTXT(archivos) {
    let output = `PROYECTO: CRONOAPP\nFECHA: ${new Date().toLocaleString()}\nARCHIVOS: ${archivos.length}\n\n`;
    archivos.forEach(f => {
        output += `FILE: ${f.path}\nDESC: ${f.desc}\nTYPE: ${f.area} > ${f.folder}\n${'-'.repeat(80)}\n${f.content}\n\n`;
    });
    try { fs.writeFileSync(FILES.TXT, output); console.log(`✅ [TXT] Contexto actualizado en H:`); } catch (e) { console.error("Error TXT:", e.message); }
}

function generarHTML(archivos) {
    const jsonStr = JSON.stringify(archivos);
    const base64Data = Buffer.from(jsonStr).toString('base64');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"><title>CronoApp Live Dashboard</title>
<style>
* { box-sizing: border-box; } body { margin: 0; display: flex; height: 100vh; font-family: 'Segoe UI', sans-serif; background: #1e1e1e; color: #d4d4d4; overflow: hidden; }
aside { width: 420px; background: #252526; border-right: 1px solid #333; display: flex; flex-direction: column; }
.head { padding: 15px; background: #2d2d2d; font-weight: bold; border-bottom: 1px solid #333; color: white; display:flex; justify-content:space-between; }
#search { width: 95%; padding: 8px; margin: 10px auto; display:block; background: #3c3c3c; border: 1px solid #444; color: white; border-radius: 4px; outline:none; }
#tree { flex: 1; overflow-y: auto; }
details { border-bottom: 1px solid #333; }
summary { padding: 10px; cursor: pointer; background: #2d2d2d; font-weight: 600; color:#ccc; }
summary:hover { color:white; }
.folder { background: #1e1e1e; }
.cat-title { font-size: 0.7rem; color: #555; padding: 5px 15px; font-weight: bold; text-transform: uppercase; margin-top:5px; }
.file { padding: 6px 15px 6px 25px; cursor: pointer; border-left: 3px solid transparent; display:flex; flex-direction:column; gap:2px; }
.file:hover { background: #2a2d2e; }
.file.active { background: #37373d; border-left-color: #007acc; }
.fname { font-size: 0.9rem; color: #9cdcfe; font-weight:bold; }
.fdesc { font-size: 0.75rem; color: #888; }
.vip { color: #ffd700 !important; }
main { flex: 1; display: flex; flex-direction: column; background: #1e1e1e; }
.top { height: 50px; border-bottom: 1px solid #333; display: flex; align-items: center; padding: 0 20px; justify-content: space-between; background:#252526; }
#path { font-family: monospace; color: #aaa; }
#editor { flex: 1; overflow: auto; padding: 20px; font-family: 'Consolas', monospace; font-size: 14px; white-space: pre-wrap; color: #d4d4d4; }
.k{color:#569cd6} .s{color:#ce9178} .c{color:#6a9955} .f{color:#dcdcaa}
button { background: #007acc; color: white; border: none; padding: 5px 15px; cursor: pointer; border-radius: 2px; }
</style>
</head>
<body>
<aside>
<div class="head"><span>CRONOAPP V4</span> <small>${archivos.length}</small></div>
<input id="search" placeholder="Filtrar..." onkeyup="render()">
<div id="tree"></div>
</aside>
<main>
<div class="top"><span id="path">Selecciona un archivo</span> <button onclick="window.print()">PDF</button></div>
<div id="editor">// El código se mostrará aquí</div>
</main>
<script>
const b64 = "${base64Data}";
let data = [];
try { data = JSON.parse(decodeURIComponent(escape(window.atob(b64)))); } catch(e){}
const tree = document.getElementById('tree');
const editor = document.getElementById('editor');
const pathEl = document.getElementById('path');

function render() {
    const q = document.getElementById('search').value.toLowerCase();
    tree.innerHTML = '';
    const gr = { 'BACKEND': {}, 'FRONTEND': {}, 'CONFIG': {}, 'OTROS': {} };
    data.forEach(f => {
        if(f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q)) {
            if(!gr[f.area][f.folder]) gr[f.area][f.folder] = [];
            gr[f.area][f.folder].push(f);
        }
    });
    Object.keys(gr).forEach(area => {
        const folders = gr[area];
        if(!Object.keys(folders).length) return;
        const det = document.createElement('details'); det.open = true;
        det.innerHTML = \`<summary>\${area}</summary>\`;
        const wrap = document.createElement('div'); wrap.className='folder';
        Object.keys(folders).sort().forEach(fld => {
            const t = document.createElement('div'); t.className='cat-title'; t.innerText=fld; wrap.appendChild(t);
            folders[fld].forEach(file => {
                const isVip = file.desc.startsWith('⭐');
                const descClass = isVip ? 'fdesc vip' : 'fdesc';
                const el = document.createElement('div'); el.className='file';
                el.innerHTML = \`<span class="fname">\${file.name}</span><span class="\${descClass}">\${file.desc}</span>\`;
                el.onclick = () => load(file, el);
                wrap.appendChild(el);
            });
        });
        det.appendChild(wrap); tree.appendChild(det);
    });
}
function load(f, el) {
    document.querySelectorAll('.file-item').forEach(e=>e.classList.remove('active')); el.classList.add('active');
    pathEl.innerText = f.path;
    let c = f.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\\b(const|let|var|function|return|if|else|import|export|class|async|await)\\b/g, '<span class="k">$1</span>')
        .replace(/('.*?'|".*?"|\`.*?\`)/g, '<span class="s">$1</span>')
        .replace(/(\\/\\/.*)/g, '<span class="c">$1</span>')
        .replace(/(\\b\\w+\\s*)(?=\\()/g, '<span class="f">$1</span>');
    editor.innerHTML = c;
}
render();
</script></body></html>`;
    try { fs.writeFileSync(FILES.HTML, html); console.log(`✅ [HTML] Dashboard actualizado en H:`); } catch(e) { console.error("Error HTML:", e.message); }
}

function main() {
    console.log(`🚀 [WATCHER] Detecté cambios. Sincronizando...`);
    if (!fs.existsSync(OUTPUT_DIR)) { console.error("❌ No existe unidad H:"); return; }
    const arch = escanear(PROJECT_ROOT);
    generarHTML(arch);
    generarTXT(arch);
    console.log(`✨ Sincronización completada.`);
}
main();