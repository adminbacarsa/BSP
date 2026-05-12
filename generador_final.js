const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN FIJA ---
const ROOT_DIR = process.cwd();
const OUTPUT_FILE = 'Dashboard_CronoApp.html';

// Filtros de Seguridad (Para no leer basura)
const IGNORE_LIST = ['node_modules', '.git', '.next', '.firebase', 'dist', 'build', 'coverage', '.vscode', 'assets', 'public', 'images'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss'];

// --- LÓGICA DE ESCANEO DIRECTO ---
function escanearProyecto(dir) {
    let results = [];
    let list = [];

    try {
        list = fs.readdirSync(dir);
    } catch (e) {
        return []; // Si no tiene permisos, salta
    }

    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const relativePath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!IGNORE_LIST.includes(file)) {
                results = results.concat(escanearProyecto(fullPath));
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            // Solo procesamos archivos de código permitidos y menores a 1MB
            if (EXTENSIONS.includes(ext) && stat.size < 1024 * 1024) {
                
                // Categorización Automática
                let area = 'OTROS';
                if (relativePath.includes('apps/functions') || relativePath.includes('backend')) area = 'BACKEND';
                else if (relativePath.includes('apps/web') || relativePath.includes('frontend')) area = 'FRONTEND';
                else if (relativePath.includes('config') || file.includes('json')) area = 'CONFIG';

                // Carpeta Padre (Para agrupar en el menú)
                const folder = path.basename(path.dirname(fullPath)).toUpperCase();

                results.push({
                    id: Math.random().toString(36).substr(2, 9),
                    name: file,
                    path: relativePath,
                    area: area,
                    folder: folder,
                    content: fs.readFileSync(fullPath, 'utf8')
                });
            }
        }
    });
    return results;
}

function generar() {
    console.log(`🚀 Iniciando Auto-Procesamiento en: ${ROOT_DIR}`);
    
    const archivos = escanearProyecto(ROOT_DIR);
    
    console.log(`📊 Archivos de código encontrados: ${archivos.length}`);

    if (archivos.length === 0) {
        console.error("❌ ERROR: No se encontraron archivos. Verifica que estás en la carpeta correcta.");
        return;
    }

    // Preparar datos para inyección segura en HTML
    const jsonFiles = JSON.stringify(archivos).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>CronoApp Dashboard</title>
    <style>
        :root { --bg: #1e1e1e; --sidebar: #252526; --accent: #007acc; --text: #cccccc; --border: #333; }
        body { margin: 0; display: flex; height: 100vh; font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); overflow: hidden; }
        
        /* SIDEBAR */
        aside { width: 340px; background: var(--sidebar); display: flex; flex-direction: column; border-right: 1px solid var(--border); }
        .header { padding: 15px; background: #2d2d2d; font-weight: bold; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; }
        .search-box { padding: 10px; border-bottom: 1px solid var(--border); }
        .search-box input { width: 100%; box-sizing: border-box; background: #3c3c3c; border: 1px solid #555; color: white; padding: 6px; outline: none; }
        
        #nav { flex: 1; overflow-y: auto; }
        
        /* ACORDEONES */
        details { border-bottom: 1px solid #2a2a2a; }
        summary { padding: 10px; cursor: pointer; background: #2d2d2d; font-size: 0.8rem; font-weight: bold; color: #bbb; user-select: none; }
        summary:hover { color: white; }
        
        .sub-group { background: #252526; }
        .folder-title { font-size: 0.7rem; color: #666; margin: 8px 0 4px 15px; font-weight: bold; text-transform: uppercase; }
        
        .file-item { padding: 4px 15px 4px 25px; cursor: pointer; font-size: 0.85rem; color: #999; display: flex; gap: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-item:hover { background: #37373d; color: white; }
        .file-item.active { background: var(--accent); color: white; font-weight: bold; }

        /* MAIN */
        main { flex: 1; display: flex; flex-direction: column; }
        .toolbar { height: 45px; background: #2d2d2d; display: flex; align-items: center; padding: 0 20px; justify-content: space-between; border-bottom: 1px solid var(--border); }
        #pathDisplay { font-family: monospace; color: #888; }
        
        #editor { flex: 1; overflow: auto; padding: 20px; font-family: 'Consolas', monospace; font-size: 14px; white-space: pre; color: #d4d4d4; }
        
        /* SYNTAX HIGHLIGHT */
        .k { color: #569cd6; } .s { color: #ce9178; } .c { color: #6a9955; } .f { color: #dcdcaa; }
    </style>
</head>
<body>

<aside>
    <div class="header">
        <span>CRONOAPP</span>
        <span style="font-size:0.8em; opacity:0.6">${archivos.length} archivos</span>
    </div>
    <div class="search-box"><input type="text" id="s" placeholder="Buscar archivo..." onkeyup="render()"></div>
    <div id="nav"></div>
</aside>

<main>
    <div class="toolbar">
        <span id="pathDisplay">Selecciona un archivo para ver el código</span>
        <button onclick="window.print()">Guardar PDF</button>
    </div>
    <div id="editor"></div>
</main>

<script>
    const data = ${jsonFiles};
    const nav = document.getElementById('nav');
    const editor = document.getElementById('editor');
    const pathLbl = document.getElementById('pathDisplay');

    function render() {
        const q = document.getElementById('s').value.toLowerCase();
        nav.innerHTML = '';
        
        // Estructura: Area -> Carpeta -> Archivos
        const tree = { 'BACKEND': {}, 'FRONTEND': {}, 'CONFIG': {}, 'OTROS': {} };

        data.forEach(f => {
            if (f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
                if (!tree[f.area][f.folder]) tree[f.area][f.folder] = [];
                tree[f.area][f.folder].push(f);
            }
        });

        Object.keys(tree).forEach(area => {
            const folders = tree[area];
            if (Object.keys(folders).length === 0) return;

            const det = document.createElement('details');
            det.open = true;
            det.innerHTML = \`<summary>\${area}</summary>\`;
            
            const content = document.createElement('div');
            content.className = 'sub-group';

            Object.keys(folders).sort().forEach(folder => {
                const title = document.createElement('div');
                title.className = 'folder-title';
                title.innerText = folder;
                content.appendChild(title);

                folders[folder].forEach(f => {
                    const item = document.createElement('div');
                    item.className = 'file-item';
                    item.innerText = f.name;
                    item.onclick = () => load(f, item);
                    content.appendChild(item);
                });
            });
            det.appendChild(content);
            nav.appendChild(det);
        });
    }

    function load(f, el) {
        document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        pathLbl.innerText = f.path;
        
        // Limpieza y coloreado
        let code = f.content.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        code = code.replace(/\\b(const|let|var|function|return|if|else|import|export|class|async|await|interface)\\b/g, '<span class="k">$1</span>')
                   .replace(/('.*?'|".*?"|\`.*?\`)/g, '<span class="s">$1</span>')
                   .replace(/(\\/\\/.*)/g, '<span class="c">$1</span>')
                   .replace(/(\\b\\w+\\s*)(?=\\()/g, '<span class="f">$1</span>');
                   
        editor.innerHTML = code;
    }
    
    render();
</script>

</body>
</html>
    `;

    fs.writeFileSync(OUTPUT_FILE, html);
    console.log(`✅ ¡ÉXITO! Dashboard generado: ${OUTPUT_FILE}`);
}

generar();