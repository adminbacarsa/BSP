const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
const INPUT_FILE = 'contexto_limpio.txt';
const OUTPUT_FILE = 'CronoApp_Audit_System.html';

// --- LÓGICA DE ANÁLISIS ---
function analizarLogica(filePath, content) {
    const lower = filePath.toLowerCase();
    let description = "Archivo de soporte.";
    let tags = [];

    // Lógica Backend
    if (lower.includes('.controller.')) {
        description = "ENDPOINT API: Recibe peticiones HTTP, valida permisos y datos de entrada antes de llamar al servicio.";
        tags.push("API", "Entrada");
    } else if (lower.includes('.service.')) {
        description = "LÓGICA DE NEGOCIO: Contiene el núcleo del procesamiento, cálculos y comunicación directa con la base de datos (Firestore).";
        tags.push("Lógica", "DB");
    } else if (lower.includes('.module.')) {
        description = "INYECCIÓN DE DEPENDENCIAS: Archivo de configuración que agrupa controladores y servicios para que funcionen juntos.";
        tags.push("Config");
    } else if (lower.includes('cron')) {
        description = "AUTOMATIZACIÓN: Tarea programada que se ejecuta periódicamente (ej: cerrar turnos vencidos).";
        tags.push("Cron", "Auto");
    } 
    
    // Lógica Frontend
    else if (lower.includes('pages')) {
        description = "VISTA PRINCIPAL: Página accesible mediante URL. Orquesta la carga de datos y la disposición de los componentes.";
        tags.push("Ruta", "UI");
    } else if (lower.includes('components') && lower.includes('map')) {
        description = "VISUALIZACIÓN GEOGRÁFICA: Componente complejo encargado de renderizar mapas, marcadores y estados operativos.";
        tags.push("Mapa", "Interactivo");
    } else if (lower.includes('hooks') || lower.startsWith('use')) {
        description = "GESTOR DE ESTADO: Hook personalizado que maneja la lógica reactiva y la suscripción a datos en tiempo real (Snapshots).";
        tags.push("Lógica UI", "Data");
    }

    return { description, tags };
}

function generarDashboard() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ ERROR: No existe '${INPUT_FILE}'. Ejecuta el generador de contexto primero.`);
        return;
    }

    console.log("🧠 Analizando estructura lógica...");
    const rawContent = fs.readFileSync(INPUT_FILE, 'utf8').replace(/\r\n/g, '\n');
    const lines = rawContent.split('\n');

    // Estructura de Datos Jerárquica
    const projectTree = {
        backend: {},
        frontend: {},
        config: []
    };

    let currentFile = null;
    let currentContent = [];
    let captureContent = false;

    // Parser
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('FILE: ')) {
            if (currentFile) procesarArchivo(currentFile, currentContent.join('\n'), projectTree);
            
            currentFile = line.replace('FILE: ', '').trim();
            currentContent = [];
            captureContent = false;
        } else if (line.startsWith('======')) {
            if (currentFile) captureContent = true;
        } else {
            if (captureContent && currentFile) currentContent.push(lines[i]);
        }
    }
    if (currentFile) procesarArchivo(currentFile, currentContent.join('\n'), projectTree);

    console.log("🔨 Construyendo interfaz gráfica...");
    crearHTML(projectTree);
}

function procesarArchivo(filePath, content, tree) {
    const parts = filePath.split(path.sep); // Dividir por carpetas
    const fileName = path.basename(filePath);
    const meta = analizarLogica(filePath, content);
    
    const fileData = {
        id: Math.random().toString(36).substr(2, 9),
        name: fileName,
        path: filePath,
        content: escapeHtml(content),
        logic: meta.description,
        tags: meta.tags
    };

    // Clasificación
    if (filePath.includes('apps/functions') || filePath.includes('apps\\functions')) {
        // Intentar agrupar por módulos (src/modules/X)
        const moduleMatch = filePath.match(/modules[\\/]([^\\/]+)/);
        const moduleName = moduleMatch ? moduleMatch[1].toUpperCase() : 'GENERAL';
        
        if (!tree.backend[moduleName]) tree.backend[moduleName] = [];
        tree.backend[moduleName].push(fileData);

    } else if (filePath.includes('apps/web') || filePath.includes('apps\\web')) {
        // Agrupar por tipo (Pages, Components, Hooks)
        let group = 'OTROS';
        if (filePath.includes('pages')) group = 'PÁGINAS (RUTAS)';
        else if (filePath.includes('components')) group = 'COMPONENTES UI';
        else if (filePath.includes('hooks')) group = 'HOOKS (LÓGICA)';
        else if (filePath.includes('lib')) group = 'LIBRERÍAS';

        if (!tree.frontend[group]) tree.frontend[group] = [];
        tree.frontend[group].push(fileData);
    } else {
        tree.config.push(fileData);
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function crearHTML(tree) {
    const jsonTree = JSON.stringify(tree).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CronoApp System Audit</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>

    <style>
        :root {
            --bg: #0f172a;
            --sidebar: #1e293b;
            --border: #334155;
            --text: #f1f5f9;
            --text-muted: #94a3b8;
            --primary: #3b82f6;
            --secondary: #10b981;
            --accent: #f59e0b;
            --code-bg: #0d1117;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }

        /* SIDEBAR */
        aside { width: 350px; background: var(--sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .brand { padding: 20px; border-bottom: 1px solid var(--border); background: #020617; }
        .brand h1 { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.5px; color: white; }
        .brand span { color: var(--primary); }
        .brand p { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; }

        .nav-container { flex: 1; overflow-y: auto; padding: 10px; }
        
        /* Acordeones */
        details { margin-bottom: 5px; border-radius: 6px; overflow: hidden; }
        summary { 
            padding: 12px; cursor: pointer; background: rgba(255,255,255,0.03); 
            font-weight: 600; font-size: 0.85rem; user-select: none;
            display: flex; justify-content: space-between; align-items: center;
            transition: background 0.2s;
        }
        summary:hover { background: rgba(255,255,255,0.08); }
        summary::marker { content: ''; }
        summary::after { content: '\\f078'; font-family: 'Font Awesome 6 Free'; font-weight: 900; font-size: 0.7rem; transition: transform 0.2s; }
        details[open] summary::after { transform: rotate(180deg); }
        details[open] summary { background: rgba(255,255,255,0.05); border-bottom: 1px solid var(--border); }

        .sub-group { padding: 5px 0 5px 15px; border-left: 2px solid var(--border); margin-left: 10px; }
        .sub-summary { font-size: 0.8rem; color: var(--text-muted); padding: 8px; text-transform: uppercase; letter-spacing: 1px; }

        .file-link { 
            display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 25px; 
            font-size: 0.85rem; color: var(--text-muted); cursor: pointer; text-decoration: none; 
            border-left: 2px solid transparent; transition: all 0.2s; 
        }
        .file-link:hover { color: white; background: rgba(255,255,255,0.05); }
        .file-link.active { color: var(--primary); border-left-color: var(--primary); background: rgba(59, 130, 246, 0.1); }
        .file-link i { width: 15px; text-align: center; font-size: 0.8rem; }

        /* MAIN */
        main { flex: 1; display: flex; flex-direction: column; height: 100%; position: relative; }
        
        /* TOP BAR */
        .top-bar { 
            height: 60px; border-bottom: 1px solid var(--border); display: flex; 
            align-items: center; justify-content: space-between; padding: 0 20px; 
            background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(10px);
        }
        .file-meta h2 { font-size: 1rem; font-family: 'JetBrains Mono', monospace; }
        .file-path { font-size: 0.75rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
        .actions { display: flex; gap: 10px; }
        .btn { 
            padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); 
            background: transparent; color: var(--text); cursor: pointer; font-size: 0.8rem; 
            display: flex; align-items: center; gap: 6px; transition: all 0.2s;
        }
        .btn:hover { background: var(--primary); border-color: var(--primary); }
        .btn-refresh { color: var(--secondary); border-color: var(--secondary); }
        .btn-refresh:hover { background: var(--secondary); color: white; }

        /* CONTENT AREA */
        .content-area { flex: 1; overflow-y: auto; padding: 30px; display: none; }
        .content-area.active { display: block; }

        /* LOGIC CARD */
        .logic-card { 
            background: #162032; border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; 
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .logic-title { font-size: 0.8rem; font-weight: 800; color: var(--accent); text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .logic-text { font-size: 0.95rem; line-height: 1.6; color: #cbd5e1; }
        .tags { display: flex; gap: 8px; margin-top: 15px; }
        .tag { font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); color: var(--text-muted); }

        /* CODE EDITOR */
        .code-wrapper { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--code-bg); }
        .code-header { 
            padding: 8px 15px; background: #1f293b; border-bottom: 1px solid var(--border); 
            font-size: 0.75rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;
            display: flex; justify-content: space-between;
        }
        pre { margin: 0; padding: 20px; overflow-x: auto; }
        code { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; line-height: 1.5; color: #e5e7eb; }

        /* WELCOME */
        .welcome { 
            height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; 
            text-align: center; color: var(--text-muted); 
        }
        .welcome i { font-size: 4rem; margin-bottom: 20px; color: var(--primary); opacity: 0.5; }
        .welcome h2 { font-size: 1.5rem; color: white; margin-bottom: 10px; }

        /* SYNTAX */
        .kw { color: #c678dd; } .fn { color: #61afef; } .str { color: #98c379; } .cm { color: #5c6370; font-style: italic; }
    </style>
</head>
<body>

    <aside>
        <div class="brand">
            <h1>CronoApp <span>Audit</span></h1>
            <p>Sistema de Auditoría Técnica</p>
            <p style="font-size: 0.65rem; opacity: 0.5; margin-top: 2px;">Generado: ${new Date().toLocaleString()}</p>
        </div>
        <div class="nav-container" id="navRoot">
            </div>
    </aside>

    <main>
        <div class="top-bar">
            <div class="file-meta" id="headerMeta" style="opacity: 0;">
                <h2 id="headerTitle">Nombre del Archivo</h2>
                <span class="file-path" id="headerPath">ruta/del/archivo</span>
            </div>
            <div class="actions">
                <button class="btn btn-refresh" onclick="alert('Para actualizar, ejecuta nuevamente: node generar_dashboard_ultimate.js en tu terminal.')">
                    <i class="fas fa-sync"></i> Actualizar
                </button>
                <button class="btn" onclick="exportPDF()">
                    <i class="fas fa-file-pdf"></i> PDF
                </button>
            </div>
        </div>

        <div id="welcomeScreen" class="welcome">
            <i class="fas fa-laptop-code"></i>
            <h2>Selecciona un componente</h2>
            <p>Navega por el panel izquierdo para auditar la lógica y código.</p>
        </div>

        <div id="contentArea" class="content-area">
            <div class="logic-card">
                <div class="logic-title"><i class="fas fa-brain"></i> Análisis Lógico</div>
                <p class="logic-text" id="logicDesc">Descripción del archivo...</p>
                <div class="tags" id="logicTags"></div>
            </div>

            <div class="code-wrapper">
                <div class="code-header">CÓDIGO FUENTE</div>
                <pre><code id="codeBlock"></code></pre>
            </div>
        </div>
    </main>

    <script>
        const data = ${jsonTree};

        function init() {
            const nav = document.getElementById('navRoot');
            
            // 1. BACKEND SECTION
            const backendDetails = createSection('BACKEND (Functions)', 'fa-server', 'var(--primary)');
            Object.keys(data.backend).forEach(moduleName => {
                const subDetails = document.createElement('details');
                subDetails.innerHTML = \`<summary class="sub-summary"><i class="fas fa-folder" style="margin-right:8px"></i> \${moduleName}</summary>\`;
                const subGroup = document.createElement('div');
                subGroup.className = 'sub-group';
                
                data.backend[moduleName].forEach(file => {
                    subGroup.appendChild(createFileLink(file));
                });
                
                subDetails.appendChild(subGroup);
                backendDetails.querySelector('.group-content').appendChild(subDetails);
            });
            nav.appendChild(backendDetails);

            // 2. FRONTEND SECTION
            const frontendDetails = createSection('FRONTEND (Web)', 'fa-desktop', 'var(--secondary)');
            Object.keys(data.frontend).forEach(groupName => {
                const subDetails = document.createElement('details');
                subDetails.innerHTML = \`<summary class="sub-summary"><i class="fas fa-layer-group" style="margin-right:8px"></i> \${groupName}</summary>\`;
                const subGroup = document.createElement('div');
                subGroup.className = 'sub-group';
                
                data.frontend[groupName].forEach(file => {
                    subGroup.appendChild(createFileLink(file));
                });
                
                subDetails.appendChild(subGroup);
                frontendDetails.querySelector('.group-content').appendChild(subDetails);
            });
            nav.appendChild(frontendDetails);

            // 3. CONFIG
            const configDetails = createSection('CONFIGURACIÓN', 'fa-cogs', '#94a3b8');
            const configGroup = document.createElement('div');
            configGroup.className = 'sub-group';
            data.config.forEach(file => configGroup.appendChild(createFileLink(file)));
            configDetails.querySelector('.group-content').appendChild(configGroup);
            nav.appendChild(configDetails);
        }

        function createSection(title, icon, color) {
            const details = document.createElement('details');
            details.open = true;
            details.innerHTML = \`
                <summary style="color: \${color}"><i class="fas \${icon}" style="margin-right: 10px;"></i> \${title}</summary>
                <div class="group-content" style="padding-left: 10px;"></div>
            \`;
            return details;
        }

        function createFileLink(file) {
            const a = document.createElement('a');
            a.className = 'file-link';
            let icon = 'fa-file-code';
            if (file.name.includes('ts')) icon = 'fa-js-square';
            if (file.name.includes('json')) icon = 'fa-cog';
            
            a.innerHTML = \`<i class="fas \${icon}"></i> \${file.name}\`;
            a.onclick = () => loadFile(file, a);
            return a;
        }

        function loadFile(file, element) {
            // UI Updates
            document.querySelectorAll('.file-link').forEach(e => e.classList.remove('active'));
            element.classList.add('active');
            document.getElementById('welcomeScreen').style.display = 'none';
            document.getElementById('contentArea').classList.add('active');
            document.getElementById('headerMeta').style.opacity = '1';

            // Set Data
            document.getElementById('headerTitle').innerText = file.name;
            document.getElementById('headerPath').innerText = file.path;
            document.getElementById('logicDesc').innerText = file.logic;
            
            // Tags
            const tagsContainer = document.getElementById('logicTags');
            tagsContainer.innerHTML = '';
            file.tags.forEach(tag => {
                const span = document.createElement('span');
                span.className = 'tag';
                span.innerText = tag;
                tagsContainer.appendChild(span);
            });

            // Code & Syntax
            document.getElementById('codeBlock').innerHTML = syntaxHighlight(file.content);
        }

        function syntaxHighlight(code) {
            let html = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            html = html.replace(/\\b(import|export|const|let|var|function|return|if|else|async|await|class|interface|from)\\b/g, '<span class="kw">$1</span>');
            html = html.replace(/\\b(string|number|boolean|any|void|Promise|console|log)\\b/g, '<span class="fn">$1</span>');
            html = html.replace(/('''.*?'''|'.*?'|".*?")/g, '<span class="str">$1</span>');
            html = html.replace(/(\\/\\/.*)/g, '<span class="cm">$1</span>');
            return html;
        }

        function exportPDF() {
            const element = document.getElementById('contentArea');
            const title = document.getElementById('headerTitle').innerText;
            const opt = {
                margin: 10,
                filename: \`Auditoria_\${title}.pdf\`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };
            html2pdf().set(opt).from(element).save();
        }

        init();
    </script>
</body>
</html>
    `;

    fs.writeFileSync(OUTPUT_FILE, html);
    console.log(`✅ DASHBOARD GENERADO: ${OUTPUT_FILE}`);
}

generarDashboard();