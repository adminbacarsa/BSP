#!/usr/bin/env node
/**
 * Alta guiada del bridge de WhatsApp de una empresa de la plataforma. Se ejecuta EN EL SERVIDOR,
 * en la carpeta del bridge, cada vez que se crea una empresa nueva:
 *
 *   node alta-empresa.js
 *
 * Qué hace (pregunta antes de cada paso que toca algo):
 *   1. Lee las empresas de la plataforma (solo lectura) y te deja elegir una.
 *   2. Propone nombre corto (slug), puerto libre y si el bridge le escribe al guardia por privado.
 *   3. Agrega la empresa a ecosystem.config.js (con copia de seguridad).
 *   4. Agrega la ruta al Caddyfile real, si lo encuentra (con copia de seguridad), e intenta recargar caddy.
 *   5. Arranca el proceso con pm2 y verifica que responda.
 *   6. Muestra y guarda la ficha: direcciones de vinculación (QR), URL para pegar en la plataforma
 *      (Configuración → WA Bridge) y lo que quede pendiente. Ficha en altas/<slug>.txt.
 *
 * No escribe nada en la plataforma. Para leer las empresas necesita credenciales de Firebase:
 *   - service-account.json junto a este archivo (Firebase → Configuración del proyecto → Cuentas de
 *     servicio → Generar clave privada; está ignorado por git, no se sube), o
 *   - la variable GOOGLE_APPLICATION_CREDENTIALS apuntando a ese archivo.
 * Sin credenciales (o con --manual) se pide el id de la empresa a mano.
 *
 * Opciones:  --manual            no leer la plataforma; pedir id y nombre
 *            --empresa <id>      elegir directamente esa empresa
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const readline = require('readline');
const { execSync } = require('child_process');

const DIR = __dirname;
const DOMAIN = process.env.WA_BRIDGE_DOMAIN || 'autbacar.dnsalias.com';
const PROJECT_ID = 'comtroldata';
const ECO_PATH = path.join(DIR, 'ecosystem.config.js');
const SNIPPET_PATH = path.join(DIR, 'caddy-snippet.conf');
const FICHAS_DIR = path.join(DIR, 'altas');

const CADDY_CANDIDATOS = [
  process.env.CADDYFILE || '',
  'C:\\ProgramData\\Caddy\\Caddyfile',
  'C:\\Caddy\\Caddyfile',
  'C:\\caddy\\Caddyfile',
  'C:\\services\\caddy\\Caddyfile',
  path.join(process.env.USERPROFILE || '', '.caddy', 'Caddyfile'),
].filter(Boolean);

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valorArg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? String(args[i + 1] || '').trim() : '';
};

// ── Utilidades de consola ────────────────────────────────────────────────────

const ok = (m) => console.log(`    [OK] ${m}`);
const aviso = (m) => console.log(`    [!!] ${m}`);
const paso = (m) => console.log(`\n==> ${m}`);

function salir(msg) {
  console.error(`\n[XX] ${msg}\n`);
  process.exit(1);
}

function crearPreguntador(rl) {
  const it = rl[Symbol.asyncIterator]();
  const ask = async (texto, def = '') => {
    process.stdout.write(`${texto}${def ? ` [${def}]` : ''}: `);
    const { value, done } = await it.next();
    if (done) {
      process.stdout.write('\n');
      return def;
    }
    const v = String(value || '').trim();
    return v || def;
  };
  const si = async (texto, defSi = true) => {
    const r = (await ask(`${texto} (${defSi ? 'S/n' : 's/N'})`)).toLowerCase();
    if (!r) return defSi;
    return r.startsWith('s') || r === 'y';
  };
  return { ask, si };
}

function sello() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function puertoLibre(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

function pedirEstado(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/status', timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode === 200, data: JSON.parse(body) });
        } catch {
          resolve({ ok: res.statusCode === 200, data: null });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, data: null });
    });
    req.on('error', () => resolve({ ok: false, data: null }));
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ecosystem.config.js ──────────────────────────────────────────────────────

function leerEcosystem() {
  const texto = fs.readFileSync(ECO_PATH, 'utf8');
  const m = texto.match(/\/\/ EMPRESAS:START\r?\n([\s\S]*?)\/\/ EMPRESAS:END/);
  if (!m) throw new Error('ecosystem.config.js no tiene las marcas EMPRESAS:START / EMPRESAS:END (copiá la versión nueva).');
  const lista = [...m[1].matchAll(/slug:\s*'([^']+)'\s*,\s*port:\s*(\d+)\s*,\s*responder:\s*(true|false)/g)].map((x) => ({
    slug: x[1],
    port: parseInt(x[2], 10),
    responder: x[3] === 'true',
  }));
  if (lista.length === 0) throw new Error('No pude leer las empresas actuales de ecosystem.config.js.');
  return { texto, lista };
}

function agregarAEcosystem(texto, { slug, port, responder }) {
  const linea = `  { slug: '${slug}', port: ${port}, responder: ${responder ? 'true' : 'false'} },`;
  const nuevo = texto.replace(/(\r?\n)\];(\r?\n\/\/ EMPRESAS:END)/, `$1${linea}$1];$2`);
  if (nuevo === texto) throw new Error('No pude insertar la empresa en ecosystem.config.js.');
  return nuevo;
}

// ── Caddy ────────────────────────────────────────────────────────────────────

function bloqueCaddy(slug, port, sangria = '') {
  const l = [
    `# WA Bridge - ${slug}`,
    `handle /${slug}/* {`,
    `    uri strip_prefix /${slug}`,
    `    reverse_proxy localhost:${port}`,
    `}`,
  ];
  return l.map((x) => `${sangria}${x}`).join('\n');
}

function buscarCaddyfile() {
  const candidatos = [...CADDY_CANDIDATOS];
  try {
    const info = execSync('pm2 show caddy --no-color', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const m = info.match(/exec path\s*[:│|]\s*([^\r\n│|]+)/);
    if (m) {
      const dir = path.dirname(m[1].trim());
      candidatos.push(path.join(dir, 'Caddyfile'), path.join(dir, 'caddy', 'Caddyfile'));
    }
  } catch {
    /* caddy no está en pm2 */
  }
  return candidatos.find((p) => fs.existsSync(p)) || '';
}

function agregarAlCaddyfile(caddyfile, slug, port) {
  const contenido = fs.readFileSync(caddyfile, 'utf8');
  if (contenido.includes(`handle /${slug}/*`)) return 'ya_estaba';
  const ultima = contenido.lastIndexOf('}');
  if (ultima < 0) throw new Error('El Caddyfile no tiene un bloque de sitio (no encontré "}").');
  const copia = `${caddyfile}.bak-${sello()}`;
  fs.copyFileSync(caddyfile, copia);
  const nuevo = `${contenido.slice(0, ultima).replace(/\s*$/, '\n')}\n${bloqueCaddy(slug, port, '    ')}\n${contenido.slice(ultima)}`;
  fs.writeFileSync(caddyfile, nuevo, 'utf8');
  return copia;
}

// ── Plataforma (solo lectura) ────────────────────────────────────────────────

async function leerEmpresasPlataforma() {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    return { error: 'firebase-admin no está instalado en esta carpeta (ejecutá "npm install").' };
  }
  const clave = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(DIR, 'service-account.json');
  try {
    const opciones = { projectId: PROJECT_ID };
    if (fs.existsSync(clave)) {
      opciones.credential = admin.credential.cert(JSON.parse(fs.readFileSync(clave, 'utf8')));
    } else {
      opciones.credential = admin.credential.applicationDefault();
    }
    const app = admin.initializeApp(opciones, `alta-${Date.now()}`);
    const db = app.firestore();
    const leer = async () => {
      const snap = await db.collection('empresas').get();
      const filas = [];
      for (const d of snap.docs) {
        const data = d.data() || {};
        if (data.active === false) continue;
        const cfg = await db.doc(`empresas/${d.id}/config/wa-bridge`).get();
        const url = cfg.exists && typeof cfg.data()?.url === 'string' ? String(cfg.data().url).trim() : '';
        filas.push({ id: d.id, name: String(data.name || data.nombre || d.id), url });
      }
      return filas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    };
    const empresas = await Promise.race([
      leer(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo de espera agotado')), 25000)),
    ]);
    return { empresas };
  } catch (e) {
    return { error: `${e && e.message ? e.message : e}` };
  }
}

function slugSugerido(id, nombre) {
  const base = String(id || nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_.-]+sa\.?$/, '')
    .replace(/[^a-z0-9]+/g, '');
  return base.slice(0, 30) || 'empresa';
}

// ── Ficha final ──────────────────────────────────────────────────────────────

function armarFicha(d) {
  const urlPublica = `https://${DOMAIN}/${d.slug}`;
  const L = [];
  L.push('============================================================');
  L.push(` FICHA DE ALTA - WA Bridge de ${d.empresa.name}`);
  L.push(` Generada: ${new Date().toLocaleString('es-AR')}`);
  L.push('============================================================');
  L.push('');
  L.push('EMPRESA');
  L.push(`  Nombre ........... ${d.empresa.name}`);
  L.push(`  Id plataforma .... ${d.empresa.id}`);
  L.push('');
  L.push('SERVIDOR');
  L.push(`  Proceso pm2 ...... wa-${d.slug}`);
  L.push(`  Puerto ........... ${d.port}`);
  L.push(`  Sesion WhatsApp .. ${path.join(DIR, `.wa_auth_${d.slug}`)}`);
  L.push(`  Privados al guardia (responder) ... ${d.responder ? 'SI' : 'NO'}`);
  L.push(`  Logs ............. pm2 logs wa-${d.slug}   |   ${path.join(DIR, 'logs', `out-${d.slug}.log`)}`);
  L.push('');
  L.push('DIRECCIONES');
  L.push(`  Vincular WhatsApp (QR) ... ${urlPublica}/qr`);
  L.push(`  Estado (JSON) ............ ${urlPublica}/status`);
  L.push(`  En el servidor ........... http://localhost:${d.port}/qr`);
  L.push('');
  L.push('DATOS PARA LA PLATAFORMA');
  L.push(`  Entrar con la empresa "${d.empresa.name}" -> Configuracion -> WA Bridge`);
  L.push(`  URL del servidor ......... ${urlPublica}`);
  L.push('  Tocar "Probar conexion" (debe decir Conectado) y luego "Guardar".');
  L.push(`  (Se guarda en Firestore: empresas/${d.empresa.id}/config/wa-bridge  { url })`);
  L.push('');
  if (d.existente) {
    L.push('ESTADO (consulta; el alta ya estaba hecha)');
    L.push(`  [${d.respondeLocal ? 'x' : ' '}] El bridge responde en el puerto ${d.port}${d.respondeLocal ? '' : ' (desde este equipo no responde: revisar pm2)'}`);
    L.push('  Si hay que volver a vincular WhatsApp, usar la direccion del QR de arriba.');
  } else {
    L.push('PASOS');
    L.push(`  [${d.ecoOk ? 'x' : ' '}] Empresa agregada a ecosystem.config.js`);
    L.push(`  [${d.caddyOk ? 'x' : ' '}] Ruta /${d.slug}/ en el Caddyfile${d.caddyOk ? '' : ' (PENDIENTE, ver abajo)'}`);
    L.push(`  [${d.caddyRecargado ? 'x' : ' '}] Caddy recargado${d.caddyRecargado ? '' : ' (PENDIENTE)'}`);
    L.push(`  [${d.pm2Ok ? 'x' : ' '}] Proceso arrancado con pm2${d.pm2Ok ? '' : ' (PENDIENTE)'}`);
    L.push(`  [${d.respondeLocal ? 'x' : ' '}] El bridge responde en el puerto ${d.port}`);
    L.push(`  [ ] Escanear el QR con el WhatsApp de la empresa (WhatsApp -> Dispositivos vinculados -> Vincular)`);
    L.push('  [ ] Pegar la URL en Configuracion -> WA Bridge de la plataforma y guardar');
    L.push('  [ ] En Centro de Control -> Modo Rapido, elegir los grupos a monitorear');
    L.push('      (el numero vinculado tiene que ser miembro de esos grupos)');
  }
  const pend = [];
  if (!d.existente && !d.pm2Ok) {
    pend.push(`  cd ${DIR}`);
    pend.push(`  pm2 start ecosystem.config.js --only wa-${d.slug}`);
    pend.push('  pm2 save');
  }
  if (!d.existente && !d.caddyOk) {
    pend.push('');
    pend.push(`  Agregar dentro del bloque de ${DOMAIN} en el Caddyfile:`);
    pend.push(bloqueCaddy(d.slug, d.port, '    '));
  }
  if (!d.existente && !d.caddyRecargado) {
    pend.push('');
    pend.push('  Recargar caddy (alguno de estos, segun como corra):');
    pend.push('    caddy reload --config <ruta del Caddyfile>');
    pend.push('    Restart-Service Caddy        (PowerShell como administrador)');
    pend.push('    pm2 restart caddy');
  }
  if (pend.length) {
    L.push('');
    L.push('COMANDOS PENDIENTES');
    L.push(...pend);
  }
  L.push('');
  return L.join('\n');
}

function guardarFicha(slug, texto) {
  fs.mkdirSync(FICHAS_DIR, { recursive: true });
  const archivo = path.join(FICHAS_DIR, `${slug}.txt`);
  fs.writeFileSync(archivo, texto, 'utf8');
  return archivo;
}

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  if (process.platform === 'win32') {
    try {
      execSync('chcp 65001', { stdio: 'ignore' });
    } catch {
      /* consola sin chcp */
    }
  }

  console.log('\n==========================================');
  console.log('  Alta de WA Bridge por empresa');
  console.log(`  Carpeta: ${DIR}`);
  console.log('==========================================');

  let eco;
  try {
    eco = leerEcosystem();
  } catch (e) {
    salir(e.message);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { ask, si } = crearPreguntador(rl);

  // 1. Empresa
  paso('Empresas de la plataforma');
  let empresas = [];
  if (!flag('--manual')) {
    const r = await leerEmpresasPlataforma();
    if (r.empresas) {
      empresas = r.empresas;
    } else {
      aviso(`No pude leer la plataforma: ${r.error}`);
      aviso('Pasamos a modo manual (te pido el id de la empresa).');
    }
  }

  let empresa = null;
  if (empresas.length > 0) {
    const porSlugUrl = (url) => {
      const seg = String(url || '').replace(/\/+$/, '').split('/').pop() || '';
      return eco.lista.find((e) => e.slug === seg);
    };
    empresas.forEach((e, i) => {
      const estado = e.url
        ? `YA TIENE bridge: ${e.url}${porSlugUrl(e.url) ? ` (puerto ${porSlugUrl(e.url).port})` : ''}`
        : 'sin bridge';
      console.log(`  ${String(i + 1).padStart(2)}) ${e.name}  [${e.id}]  - ${estado}`);
    });
    const pedido = valorArg('--empresa');
    if (pedido) {
      empresa = empresas.find((e) => e.id === pedido) || null;
      if (!empresa) salir(`No encontré la empresa "${pedido}" en la plataforma.`);
    } else {
      const sin = empresas.filter((e) => !e.url);
      const def = sin.length === 1 ? String(empresas.indexOf(sin[0]) + 1) : '';
      const r = await ask('\nElegí el número de la empresa (M = escribir un id a mano, Enter = salir)', def);
      if (!r) {
        rl.close();
        console.log('\nNada que hacer. Hasta luego.\n');
        return;
      }
      if (r.toLowerCase() === 'm') {
        empresa = null;
      } else {
        const n = parseInt(r, 10);
        if (!Number.isFinite(n) || n < 1 || n > empresas.length) salir('Número fuera de la lista.');
        empresa = empresas[n - 1];
      }
    }
  }
  if (!empresa) {
    const id = await ask('Id de la empresa en la plataforma (ej.: grupos_bacar_sa)');
    if (!id) salir('Sin id de empresa no se puede continuar.');
    const nombre = await ask('Nombre de la empresa', id);
    empresa = { id, name: nombre, url: '' };
  }

  // Si ya tiene bridge, mostrar su ficha y ofrecer rehacerla
  if (empresa.url) {
    const seg = empresa.url.replace(/\/+$/, '').split('/').pop() || '';
    const actual = eco.lista.find((e) => e.slug === seg);
    console.log(`\n${empresa.name} ya tiene un bridge configurado en la plataforma: ${empresa.url}`);
    if (actual) {
      const estado = await pedirEstado(actual.port);
      const ficha = armarFicha({
        empresa,
        slug: actual.slug,
        port: actual.port,
        responder: actual.responder,
        existente: true,
        pm2Ok: estado.ok,
        respondeLocal: estado.ok,
      });
      console.log(`\n${ficha}`);
    }
    if (!(await si('¿Crear igualmente un bridge NUEVO para esta empresa?', false))) {
      rl.close();
      console.log('\nNo se cambió nada.\n');
      return;
    }
  }

  // 2. Datos del bridge
  paso('Datos del bridge');
  let slug = '';
  for (;;) {
    slug = (await ask('Nombre corto (slug) para la ruta, el proceso y la sesión', slugSugerido(empresa.id, empresa.name))).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) {
      aviso('Usá 2 a 30 caracteres: minúsculas, números y guion.');
      continue;
    }
    if (eco.lista.some((e) => e.slug === slug)) {
      aviso(`Ya existe un bridge con el slug "${slug}".`);
      continue;
    }
    break;
  }

  let sugerido = Math.max(...eco.lista.map((e) => e.port)) + 1;
  while (eco.lista.some((e) => e.port === sugerido) || !(await puertoLibre(sugerido))) sugerido += 1;
  let port = 0;
  for (;;) {
    port = parseInt(await ask('Puerto local', String(sugerido)), 10);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      aviso('Puerto inválido.');
      continue;
    }
    if (eco.lista.some((e) => e.port === port)) {
      aviso(`El puerto ${port} ya lo usa otro bridge.`);
      continue;
    }
    if (!(await puertoLibre(port))) {
      aviso(`El puerto ${port} está ocupado en este equipo.`);
      continue;
    }
    break;
  }

  console.log('\n  "Privados al guardia": el bridge le escribe por mensaje privado cuando se confirma su presencia');
  console.log('  y le avisa si mandó una ubicación estática o solo texto. Los avisos del intercambio de turno');
  console.log('  funcionan igual con o sin esta opción.');
  const responder = await si('¿Activar privados al guardia?', true);

  console.log('\n  Resumen');
  console.log(`    Empresa ........ ${empresa.name} [${empresa.id}]`);
  console.log(`    Proceso pm2 .... wa-${slug}`);
  console.log(`    Puerto ......... ${port}`);
  console.log(`    Sesión ......... .wa_auth_${slug}`);
  console.log(`    Privados ....... ${responder ? 'sí' : 'no'}`);
  console.log(`    URL pública .... https://${DOMAIN}/${slug}`);
  if (!(await si('\n¿Crear el alta?', true))) {
    rl.close();
    console.log('\nCancelado. No se cambió nada.\n');
    return;
  }

  const resultado = {
    empresa,
    slug,
    port,
    responder,
    ecoOk: false,
    caddyOk: false,
    caddyRecargado: false,
    pm2Ok: false,
    respondeLocal: false,
  };

  // 3. ecosystem.config.js
  paso('ecosystem.config.js');
  try {
    const copia = `${ECO_PATH}.bak-${sello()}`;
    fs.copyFileSync(ECO_PATH, copia);
    fs.writeFileSync(ECO_PATH, agregarAEcosystem(eco.texto, { slug, port, responder }), 'utf8');
    resultado.ecoOk = true;
    ok(`Empresa agregada (copia anterior: ${path.basename(copia)})`);
  } catch (e) {
    rl.close();
    salir(`No se pudo actualizar ecosystem.config.js: ${e.message}`);
  }

  // 4. Caddy
  paso('Caddy');
  try {
    const previo = fs.existsSync(SNIPPET_PATH) ? fs.readFileSync(SNIPPET_PATH, 'utf8') : '';
    if (!previo.includes(`handle /${slug}/*`)) {
      fs.writeFileSync(SNIPPET_PATH, `${previo.replace(/\s*$/, '\n')}\n${bloqueCaddy(slug, port)}\n`, 'utf8');
    }
    ok('Bloque agregado a caddy-snippet.conf (referencia)');
  } catch (e) {
    aviso(`No pude actualizar caddy-snippet.conf: ${e.message}`);
  }

  const caddyfile = buscarCaddyfile();
  if (caddyfile) {
    console.log(`  Caddyfile encontrado: ${caddyfile}`);
    if (await si('¿Agregar la ruta al Caddyfile (se hace copia de seguridad)?', true)) {
      try {
        const r = agregarAlCaddyfile(caddyfile, slug, port);
        resultado.caddyOk = true;
        ok(r === 'ya_estaba' ? 'La ruta ya estaba en el Caddyfile' : `Ruta agregada (copia: ${path.basename(r)})`);
        if (await si('¿Recargar caddy ahora?', true)) {
          try {
            execSync(`caddy reload --config "${caddyfile}"`, { stdio: 'ignore' });
            resultado.caddyRecargado = true;
            ok('Caddy recargado');
          } catch {
            try {
              execSync('pm2 restart caddy', { stdio: 'ignore' });
              resultado.caddyRecargado = true;
              ok('Caddy reiniciado con pm2');
            } catch {
              aviso('No pude recargar caddy solo; queda en la ficha como pendiente.');
            }
          }
        }
      } catch (e) {
        aviso(`No pude editar el Caddyfile: ${e.message}`);
      }
    }
  } else {
    aviso('No encontré el Caddyfile. El bloque queda en la ficha para agregarlo a mano.');
  }

  // 5. pm2
  paso('Proceso del bridge (pm2)');
  if (await si(`¿Arrancar wa-${slug} con pm2 ahora?`, true)) {
    try {
      execSync(`pm2 start ecosystem.config.js --only wa-${slug}`, { cwd: DIR, stdio: 'ignore', shell: true });
      execSync('pm2 save', { cwd: DIR, stdio: 'ignore', shell: true });
      resultado.pm2Ok = true;
      ok(`wa-${slug} arrancado y guardado en pm2`);
      process.stdout.write('    Esperando que levante');
      for (let i = 0; i < 10 && !resultado.respondeLocal; i += 1) {
        await dormir(1500);
        process.stdout.write('.');
        resultado.respondeLocal = (await pedirEstado(port)).ok;
      }
      process.stdout.write('\n');
      if (resultado.respondeLocal) ok(`Responde en http://localhost:${port}`);
      else aviso(`Todavía no responde en el puerto ${port}. Revisá: pm2 logs wa-${slug}`);
    } catch (e) {
      aviso(`No pude arrancar con pm2: ${e.message}. Queda en la ficha como pendiente.`);
    }
  }

  rl.close();

  // 6. Ficha
  const ficha = armarFicha(resultado);
  let archivo = '';
  try {
    archivo = guardarFicha(slug, ficha);
  } catch {
    /* si no se puede guardar, igual se muestra */
  }
  console.log(`\n${ficha}`);
  if (archivo) console.log(`Ficha guardada en: ${archivo}\n`);
}

// process.exit: firebase-admin deja conexiones abiertas y el proceso no terminaría solo.
main()
  .then(() => process.exit(0))
  .catch((e) => salir(e && e.stack ? e.stack : String(e)));
