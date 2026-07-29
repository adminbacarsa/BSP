/**
 * Restaura archivos de un snapshot Auto Lab sobre el código actual.
 * Uso: node scripts/restore-auto-lab-version.js 1.0
 *      npm run auto-lab:restore -- 1.0
 * Agregar --yes para omitir confirmación.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const WEB2_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(WEB2_ROOT, 'auto-lab-versions');

function usage() {
    console.error('Uso: node scripts/restore-auto-lab-version.js <version> [--yes]');
    console.error('Ej:  npm run auto-lab:restore -- 1.0');
    process.exit(1);
}

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const autoYes = args.includes('--yes');
if (!version || !/^\d+\.\d+$/.test(version)) usage();

const srcRoot = path.join(VERSIONS_DIR, `v${version}`);
const metaPath = path.join(srcRoot, 'SNAPSHOT.json');

if (!fs.existsSync(metaPath)) {
    console.error(`No existe snapshot v${version} en auto-lab-versions/v${version}/`);
    process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

function restore() {
    let count = 0;
    for (const rel of meta.files) {
        const src = path.join(srcRoot, rel.replace(/\//g, path.sep));
        const dest = path.join(WEB2_ROOT, rel.replace(/\//g, path.sep));
        if (!fs.existsSync(src)) {
            console.warn(`  ⚠ Falta en snapshot: ${rel}`);
            continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        count++;
    }
    console.log(`✓ Restaurados ${count} archivos desde Auto Lab v${version}`);
    console.log(`  Snapshot: ${meta.createdAt?.slice(0, 10)} · commit ${String(meta.gitCommit || '').slice(0, 8)}`);
    console.log(`  Notas: ${meta.notes || '—'}`);
    if (meta.recommendedEvals?.length) {
        console.log(`  Corré: npm run ${meta.recommendedEvals.join(' && npm run ')}`);
    }
}

function askConfirm(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(/^s(i)?$/i.test(answer.trim()) || /^y(es)?$/i.test(answer.trim()));
        });
    });
}

(async () => {
    console.log(`Restaurar Auto Lab v${version} (${meta.fileCount} archivos)`);
    console.log(`  ${meta.notes || ''}`);
    if (!autoYes) {
        const ok = await askConfirm('¿Sobrescribir archivos actuales? (s/N): ');
        if (!ok) {
            console.log('Cancelado.');
            process.exit(0);
        }
    }
    restore();
})();
