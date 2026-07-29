/**
 * Crea un snapshot versionado de Auto Lab en auto-lab-versions/vX.Y/
 * Uso: node scripts/snapshot-auto-lab-version.js 1.0 "Descripción del hito"
 *      npm run auto-lab:snapshot -- 1.0 "Descripción"
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WEB2_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(WEB2_ROOT, 'auto-lab-versions');
const MANIFEST_PATH = path.join(VERSIONS_DIR, 'snapshot-manifest.json');
const VERSIONS_JSON = path.join(VERSIONS_DIR, 'VERSIONS.json');

function usage() {
    console.error('Uso: node scripts/snapshot-auto-lab-version.js <version> "<notas>"');
    console.error('Ej:  npm run auto-lab:snapshot -- 1.0 "Baseline validada"');
    process.exit(1);
}

const version = process.argv[2];
const notes = process.argv.slice(3).join(' ').trim();
if (!version || !/^\d+\.\d+$/.test(version)) usage();
if (!notes) usage();

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const files = manifest.files || [];
const destRoot = path.join(VERSIONS_DIR, `v${version}`);

if (fs.existsSync(destRoot)) {
    console.error(`Ya existe auto-lab-versions/v${version}. Usá otra versión o borrá la carpeta.`);
    process.exit(1);
}

let gitCommit = '';
try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: path.resolve(WEB2_ROOT, '..', '..'), encoding: 'utf8' }).trim();
} catch {
    gitCommit = 'unknown';
}

const copied = [];
const missing = [];

for (const rel of files) {
    const src = path.join(WEB2_ROOT, rel.replace(/\//g, path.sep));
    const dest = path.join(destRoot, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(src)) {
        missing.push(rel);
        continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(rel);
}

const snapshotMeta = {
    version,
    createdAt: new Date().toISOString(),
    gitCommit,
    notes,
    fileCount: copied.length,
    files: copied,
    recommendedEvals: manifest.recommendedEvals || [],
};
fs.writeFileSync(path.join(destRoot, 'SNAPSHOT.json'), `${JSON.stringify(snapshotMeta, null, 2)}\n`);

let registry = { current: version, versions: [] };
if (fs.existsSync(VERSIONS_JSON)) {
    registry = JSON.parse(fs.readFileSync(VERSIONS_JSON, 'utf8'));
}
registry.current = version;
registry.versions = (registry.versions || []).filter((v) => v.version !== version);
registry.versions.push({
    version,
    date: snapshotMeta.createdAt.slice(0, 10),
    gitCommit,
    label: notes,
    fileCount: copied.length,
    recommendedEvals: manifest.recommendedEvals || [],
});
registry.versions.sort((a, b) => {
    const pa = a.version.split('.').map(Number);
    const pb = b.version.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1];
});
fs.writeFileSync(VERSIONS_JSON, `${JSON.stringify(registry, null, 2)}\n`);

console.log(`✓ Snapshot Auto Lab v${version} → auto-lab-versions/v${version}/`);
console.log(`  Archivos: ${copied.length}`);
if (missing.length) console.warn(`  ⚠ No encontrados (${missing.length}):`, missing.join(', '));
console.log(`  Commit: ${gitCommit.slice(0, 8)}`);
console.log(`  Evals sugeridos: ${(manifest.recommendedEvals || []).join(', ')}`);
