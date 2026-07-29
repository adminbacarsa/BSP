/**
 * Lista snapshots Auto Lab disponibles.
 */
const fs = require('fs');
const path = require('path');

const VERSIONS_JSON = path.join(__dirname, '..', 'auto-lab-versions', 'VERSIONS.json');

if (!fs.existsSync(VERSIONS_JSON)) {
    console.log('No hay snapshots Auto Lab todavía.');
    console.log('Creá el primero: npm run auto-lab:snapshot -- 1.0 "Baseline"');
    process.exit(0);
}

const registry = JSON.parse(fs.readFileSync(VERSIONS_JSON, 'utf8'));
console.log(`Auto Lab — versión activa en repo: v${registry.current || '?'}\n`);
for (const v of registry.versions || []) {
    const mark = v.version === registry.current ? ' ← actual' : '';
    console.log(`  v${v.version}  ${v.date}  ${v.fileCount} archivos  ${String(v.gitCommit || '').slice(0, 8)}${mark}`);
    console.log(`         ${v.label || '—'}`);
}
