const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'apps', 'web2', 'out');
const indexPath = path.join(outDir, 'index.html');
const buildIdCorrecto = 'l8ZQy2eWW4F3bkAFrkBPW';

if (!fs.existsSync(indexPath)) {
  console.error('\nERROR: No existe apps/web2/out. En la carpeta del proyecto ejecuta:\n  git checkout HEAD -- apps/web2/out\n');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes(buildIdCorrecto)) {
  console.error('\nERROR: apps/web2/out no es la version oficial (buildId incorrecto).');
  console.error('Ejecuta en la carpeta del proyecto:\n  git checkout HEAD -- apps/web2/out\n');
  process.exit(1);
}

console.log('\n>>> Version oficial: http://localhost:5005 <<<\n');
const child = spawn('npx', ['--yes', 'http-server', outDir, '-p', '5005', '-c-1'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname
});
child.on('error', (err) => { console.error(err); process.exit(1); });
child.on('exit', (code) => process.exit(code || 0));
