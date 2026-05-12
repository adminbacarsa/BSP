const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
const INPUT_FILE = 'contexto_limpio.txt';
const OUTPUT_HTML = 'Dashboard_Final.html';

// Función para limpiar la ruta (Quitar _SNAPSHOTS_ROOT, etc)
function limpiarRuta(ruta) {
    if (!ruta) return "Desconocido";
    // Normalizar barras
    let limpia = ruta.replace(/\\/g, '/');
    
    // Si contiene "apps/", cortamos todo lo anterior
    const indexApps = limpia.indexOf('apps/');
    if (indexApps !== -1) {
        return limpia.substring(indexApps);
    }
    // Si no tiene apps/, intentamos limpiar rutas absolutas genéricas
    const partes = limpia.split('/');
    if (partes.length > 3) {
        // Devolver las últimas 3 partes como fallback
        return partes.slice(-3).join('/');
    }
    return limpia;
}

function generar() {
    console.log("🚀 Iniciando generador inteligente...");

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ ERROR: No existe '${INPUT_FILE}'.`);
        return;
    }

    const rawContent = fs.readFileSync(INPUT_FILE, 'utf8');
    let files = [];
    let contentKey = null; // Detectaremos dinámicamente dónde está el código

    // 1. INTENTAR PARSEAR JSON
    try {
        const jsonData = JSON.parse(rawContent);
        
        if (Array.isArray(jsonData) && jsonData.length > 0) {
            console.log("✅ JSON detectado.");
            
            // DETECCIÓN INTELIGENTE DE LA PROPIEDAD DE CÓDIGO
            // Buscamos en el primer elemento cuál es la propiedad que tiene el texto más largo
            const sample = jsonData[0];
            let maxLen = 0;
            
            Object.keys(sample).forEach(key => {
                if (typeof sample[key] === 'string' && sample[key].length > maxLen) {
                    maxLen = sample[key].length;
                    contentKey = key;
                }
            });
            console.log(`🔍 El código parece estar en la propiedad: '${contentKey}'`);

            // Mapeo usando la llave detectada y limpiando rutas
            files = jsonData.map(f => {
                const rutaSucia = f.path || f.name || "sin-nombre";
                const rutaLimpia = limpiarRuta(rutaSucia);
                
                // Categorización
                let area = 'OTROS';
                if (rutaLimpia.includes('functions') || rutaLimpia.includes('backend')) area = 'BACKEND';
                else if (rutaLimpia.includes('web') || rutaLimpia.includes('frontend')) area = 'FRONTEND';
                else if (rutaLimpia.includes('config') || rutaLimpia.includes('json')) area = 'CONFIG';

                // Carpeta Padre
                const partes = rutaLimpia.split('/');
                const folder = partes.length > 1 ? partes[partes.length - 2].toUpperCase() : 'RAÍZ';

                return {
                    id: Math.random().toString(36).substr(2, 9),
                    name: path.basename(rutaLimpia),
                    path: rutaLimpia, // Ruta limpia para mostrar
                    fullPath: rutaSucia, // Ruta original por si acaso
                    area: area,
                    folder: folder,
                    // Usamos la key detectada o un fallback vacío
                    content: f[contentKey] || "// Contenido vacío o no encontrado"
                };
            });
        }
    } catch (e) {
        console.log("⚠️ No es JSON válido. Intentando modo Texto Plano...");
        // Fallback a texto plano si el JSON falla
        const chunks = rawContent.split(/FILE:\s+/);
        chunks.slice(1).forEach(chunk => {
            const lines = chunk.split('\n');
            const ruta = lines[0].trim();
            const codigo = lines.slice(1).join('\n').replace(/={10,}/g, '').trim();
            if (ruta) {
                const rutaLimpia = limpiarRuta(ruta);
                files.push({
                    id: Math.random().toString(36).substr(2, 9),
                    name: path.basename(rutaLimpia),
                    path: rutaLimpia,
                    folder: 'TEXTO-PLANO',
                    area: 'IMPORTADO',
                    content: codigo
                });
            }
        });
    }

    console.log(`📊 Procesados ${files.length} archivos.`);

    // 2. GENERAR HTML
    const jsonOutput = JSON.stringify(files).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>CronoApp Dashboard</title>
    <style>
        body { margin: 0; display: flex; height: 100vh; font-family: sans-serif; background: #1e1e1e; color: #ccc; overflow: hidden; }
        aside { width: 350px; background: #252526; display: flex; flex-direction: column; border-right: 1px solid #333; }
        .head { padding: 15px; background: #2d2d2d; font-weight: bold; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;}
        .search input { width: 90%; background: #3c3c3c; border: 1px solid #555; color: white; padding: 8px; margin: 10px auto; display: block; border-radius: 4px;}
        #list { flex: 1; overflow-y: auto; }
        
        /* Acordeones estilizados */
        details { border-bottom: 1px solid #333; }
        summary { padding: 10px 15px; cursor: pointer; background: #333; font-size: 0.85rem; font-weight: bold; color: #ddd; user-select: none; }
        summary:hover { background: #3e3e3e; }
        
        .folder-block { background: #1e1e1e; }
        .folder-name { font-size: 0.75rem; color: #666; padding: 5px 15px; font-weight: bold; text-transform: uppercase; margin-top: 5px; }

        .file { padding: 4px 15px 4px 25px; cursor: pointer; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #aaa; display: flex; gap: 8px; align-items: center;}
        .file:hover { background: #007acc; color: white; }
        .file.active { background: #007acc; color: white; font-weight: bold; }

        main { flex: 1; display: flex; flex-direction: column; }
        .bar { height: 45px; background: #2d2d2d; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid #333; justify-content: space-between; }
        #pathDisplay { font-family: monospace; color: #aaa; font-size: 0.9rem; }
        
        #code { flex: 1; overflow: auto; padding: 20px; font-family: 'Consolas', monospace; font-size: 14px; white-space: pre; background: #1e1e1e; color: #d4d4d4; }
        
        .k { color: #569cd6; } .s { color: #ce9178; } .c { color: #6a9955; } .f { color: #dcdcaa; }
    </style>
</head>
<body>
<aside>
    <div class="head"><span>CRONOAPP</span> <span style="font-size:0.8em; opacity:0.7">${files.length} Archivos</span></div>
    <div class="search"><input type="text" id="s" placeholder="Filtrar archivos..." onkeyup="render()"></div>
    <div id="list"></div>
</aside>
<main>
    <div class="bar"><span id="pathDisplay">Selecciona un archivo</span> <button onclick="window.print()">Guardar PDF</button></div>
    <div id="code"></div>
</main>
<script>
    const data = ${jsonOutput};
    const list = document.getElementById('list');
    const code = document.getElementById('code');
    const path = document.getElementById('pathDisplay');

    function render() {
        const q = document.getElementById('s').value.toLowerCase();
        list.innerHTML = '';
        
        // Estructura de grupos
        const groups = { 'BACKEND': {}, 'FRONTEND': {}, 'CONFIG': {}, 'OTROS': {} };

        data.forEach(f => {
            if(f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
                // Agrupar por Area -> Carpeta
                const area = f.area;
                const folder = f.folder;
                
                if (!groups[area][folder]) groups[area][folder] = [];
                groups[area][folder].push(f);
            }
        });

        // Renderizar
        Object.keys(groups).forEach(area => {
            const folders = groups[area];
            if (Object.keys(folders).length === 0) return;

            const det = document.createElement('details');
            det.open = true; // Por defecto abierto
            det.innerHTML = \`<summary>\${area}</summary>\`;
            
            const content = document.createElement('div');
            content.className = 'folder-block';

            Object.keys(folders).sort().forEach(folder => {
                const fTitle = document.createElement('div');
                fTitle.className = 'folder-name';
                fTitle.innerText = folder;
                content.appendChild(fTitle);

                folders[folder].forEach(f => {
                    const d = document.createElement('div');
                    d.className = 'file';
                    
                    let icon = '📄';
                    if (f.name.endsWith('ts')) icon = 'TS';
                    if (f.name.endsWith('tsx')) icon = 'RX';
                    if (f.name.endsWith('css')) icon = '#';
                    
                    d.innerHTML = \`<span style="font-size:0.7em; opacity:0.7; width:20px">\${icon}</span> \${f.name}\`;
                    d.onclick = () => load(f, d);
                    content.appendChild(d);
                });
            });

            det.appendChild(content);
            list.appendChild(det);
        });
    }

    function load(f, el) {
        document.querySelectorAll('.file').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        path.innerText = f.path;
        
        let txt = f.content
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/\\b(const|let|var|function|return|if|else|import|export|class|async|await|interface)\\b/g, '<span class="k">$1</span>')
            .replace(/('.*?'|".*?"|\`.*?\`)/g, '<span class="s">$1</span>')
            .replace(/(\\/\\/.*)/g, '<span class="c">$1</span>')
            .replace(/(\\b\\w+\\s*)(?=\\()/g, '<span class="f">$1</span>');
            
        code.innerHTML = txt;
    }
    
    render();
</script>
</body>
</html>
    `;

    fs.writeFileSync(OUTPUT_HTML, html);
    console.log(`✅ ¡ÉXITO! HTML Generado: ${OUTPUT_HTML}`);
}

generar();