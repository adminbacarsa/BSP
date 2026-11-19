#!/usr/bin/env node
/**
 * Da de alta el bridge de WhatsApp de una empresa nueva.
 *
 *   node nueva-empresa.js <slug> [--responder] [--empresa <empresaId>] [--puerto <n>] [--dry-run]
 *
 *   slug        nombre corto, minúsculas/números/guion (ej.: grupobacar). Define el proceso `wa-<slug>`,
 *               la sesión `.wa_auth_<slug>` y la ruta `/<slug>/` de caddy.
 *   --responder el bridge le escribe al guardia por privado (WA_RESPONDER=1).
 *   --empresa   id de la empresa en la plataforma (solo para mostrar la ruta de configuración).
 *   --puerto    puerto fijo; por defecto el siguiente libre.
 *   --dry-run   muestra lo que haría sin escribir.
 *
 * Edita ecosystem.config.js (entre EMPRESAS:START y EMPRESAS:END) y agrega el bloque a
 * caddy-snippet.conf. No arranca nada ni toca otras empresas.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valor = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1] || '') : '';
};

const slug = String(args.find((a) => !a.startsWith('--') && a !== valor('--empresa') && a !== valor('--puerto')) || '').trim();
const responder = flag('--responder');
const empresaId = valor('--empresa').trim();
const dryRun = flag('--dry-run');

function salir(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) {
  salir('Falta el slug o es inválido (2 a 30 caracteres: minúsculas, números y guion). Ej.: node nueva-empresa.js grupobacar');
}

const ecoPath = path.join(__dirname, 'ecosystem.config.js');
const caddyPath = path.join(__dirname, 'caddy-snippet.conf');
const eco = fs.readFileSync(ecoPath, 'utf8');

const bloque = eco.match(/\/\/ EMPRESAS:START\r?\n([\s\S]*?)\/\/ EMPRESAS:END/);
if (!bloque) salir('ecosystem.config.js no tiene las marcas EMPRESAS:START / EMPRESAS:END.');

const existentes = [...bloque[1].matchAll(/slug:\s*'([^']+)'\s*,\s*port:\s*(\d+)/g)].map((m) => ({
  slug: m[1],
  port: parseInt(m[2], 10),
}));
if (existentes.length === 0) salir('No pude leer las empresas actuales de ecosystem.config.js.');
if (existentes.some((e) => e.slug === slug)) salir(`Ya existe una empresa con el slug "${slug}".`);

const puertoPedido = parseInt(valor('--puerto'), 10);
const puerto = Number.isFinite(puertoPedido) && puertoPedido > 0
  ? puertoPedido
  : Math.max(...existentes.map((e) => e.port)) + 1;
if (existentes.some((e) => e.port === puerto)) salir(`El puerto ${puerto} ya lo usa otra empresa.`);

const linea = `  { slug: '${slug}', port: ${puerto}, responder: ${responder ? 'true' : 'false'} },\n`;
const nuevoEco = eco.replace(/(\r?\n)\];(\r?\n\/\/ EMPRESAS:END)/, `$1${linea.replace(/\n$/, '')}$1];$2`);
if (nuevoEco === eco) salir('No pude insertar la empresa en ecosystem.config.js.');

const caddy = fs.existsSync(caddyPath) ? fs.readFileSync(caddyPath, 'utf8') : '';
const bloqueCaddy = `
handle /${slug}/* {
    uri strip_prefix /${slug}
    reverse_proxy localhost:${puerto}
}
`;
if (caddy.includes(`handle /${slug}/*`)) salir(`caddy-snippet.conf ya tiene un bloque para /${slug}/.`);

const url = `https://autbacar.dnsalias.com/${slug}`;

if (dryRun) {
  console.log('— dry-run: no se escribió nada —');
  console.log(`ecosystem.config.js  +${linea.trimEnd()}`);
  console.log(`caddy-snippet.conf   +${bloqueCaddy.trim().replace(/\n/g, ' ')}`);
} else {
  fs.writeFileSync(ecoPath, nuevoEco, 'utf8');
  fs.writeFileSync(caddyPath, caddy.replace(/\s*$/, '\n') + bloqueCaddy, 'utf8');
  console.log(`✓ Agregada la empresa "${slug}" (puerto ${puerto}${responder ? ', con privados al guardia' : ''}).`);
}

console.log(`
Pasos siguientes en el servidor (C:\\services\\wa-bridge):
  1. Copiar acá ecosystem.config.js y caddy-snippet.conf actualizados (wa-bridge.js no cambia).
  2. Agregar el bloque nuevo al Caddyfile y recargar caddy.
  3. pm2 start ecosystem.config.js --only wa-${slug}
     pm2 save
  4. Abrir ${url}/qr y escanear el QR con el WhatsApp que va a usar esa empresa.
  5. En la plataforma: Configuración → WA Bridge${empresaId ? ` de la empresa "${empresaId}"` : ''} → URL:
       ${url}
     (se guarda en empresas/${empresaId || '<empresaId>'}/config/wa-bridge). "Probar conexión" debe dar Conectado.
  6. En Centro de Control → Modo Rápido, elegir los grupos de WhatsApp a monitorear.
`);
