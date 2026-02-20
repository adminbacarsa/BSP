const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'apps', 'web2', 'out');
const indexPath = path.join(outDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('\nERROR: No existe apps/web2/out. Ejecuta antes: npm run build\n');
  process.exit(1);
}

console.log('\n>>> Sirviendo build en http://localhost:5005 <<<\n');
const child = spawn('npx', ['--yes', 'http-server', outDir, '-p', '5005', '-c-1'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname
});
child.on('error', (err) => { console.error(err); process.exit(1); });
child.on('exit', (code) => process.exit(code || 0));
