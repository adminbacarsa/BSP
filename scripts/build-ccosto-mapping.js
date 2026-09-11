/**
 * Genera borrador de catálogo CCosto → objectiveId (dry-run).
 * Uso: node scripts/build-ccosto-mapping.js
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '../apps/web2/node_modules/xlsx'));
const fs = require('fs');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const EXCEL = process.argv[2] || 'C:/Users/Mauro/Downloads/Mauro- Julio LOL.xlsx';
const OUT = path.join(__dirname, 'ccosto-objective-mapping.draft.json');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function ccHint(cc) {
  return norm(String(cc || '').replace(/^SP\s*-\s*/i, '').replace(/^BACAR SA\s*-\s*/i, ''));
}

/** Reglas manuales por prefijo de cliente en el CCosto. */
const CLIENT_PREFIX = [
  ['banco sede', 'BANCO DE CORDOBA'],
  ['banco ', 'BANCO DE CORDOBA'],
  ['casisa', 'CASISA'],
  ['camino', 'CASISA'],
  ['coniferal', 'CONIFERAL'],
  ['loteria', 'LOTERÍA-CASINOS'],
  ['casino', 'LOTERÍA-CASINOS'],
  ['imprenta loteria', 'LOTERÍA-CASINOS'],
  ['cet ', 'LOTERÍA-CASINOS'],
  ['caps ', 'MINISTERIO DE DESARROLLO SOCIAL'],
  ['barrio zepa', 'MINISTERIO DE DESARROLLO SOCIAL'],
  ['hospital', 'MINISTERIO DE SALUD'],
  ['instituto zoonosis', 'MINISTERIO DE SALUD'],
  ['inmunidad', 'MINISTERIO DE SALUD'],
  ['ecodaic', 'MINISTERIO DE SALUD'],
  ['centro de rehabilitacion', 'MINISTERIO DE SALUD'],
  ['tadicor', 'TADICOR'],
  ['decathlon', 'DECATHLON'],
  ['vifood', 'VIFOOD'],
  ['kempes', 'KEMPES'],
  ['estadio kempes', 'KEMPES'],
  ['atp kempes', 'KEMPES'],
  ['coorblock', 'CORBLOCK'],
  ['comarca', 'COMARCA DE VILLA ALLENDE'],
  ['colegio padre claret', 'COLEGIO PADRE CLARET'],
  ['colegio de arquitectos', 'COLEGIO DE ARQUITECTOS'],
  ['cordoba athletic', 'CORDOBA ATHLETIC'],
  ['club la tablada', 'CLUB LA TABLADA'],
  ['plaza de la musica', 'Plaza de la Musica'],
  ['la segunda', 'LA SEGUNDA'],
  ['ypf', 'YPF'],
  ['jor gus', 'JOR GUS'],
  ['distribuidora jor gus', 'JOR GUS'],
  ['alzo', 'ALZO'],
  ['villa maria shopping', 'SHOPPING DE VILLA MARIA'],
  ['shopping', 'SHOPPING DE VILLA MARIA'],
];

/** Alias CCosto fragment → nombre objetivo CRM. */
const OBJ_ALIASES = {
  'casa matriz': 'Casa Matriz',
  'edificio corporativo': 'Nuevo Edificio Corporativo',
  'data center': 'Data Center',
  'catedral': 'Sucursal Catedral',
  'sede centro': 'Sucursal Centro',
  'cerro de las rosas': 'Sucursal Cerro de las Rosas',
  'cinerama': 'Extensión Cinerama',
  'mercado norte': 'Sucursal Mercado Norte',
  'nueva cordoba': 'Sucursal Nueva Córdoba',
  'tribunales': 'Sucursal Tribunales',
  'plaza rivadavia': 'Sucursal Plaza Rivadavia',
  'fuerza aerea': 'Sucursal Fuerza Aerea',
  'vcp': 'Sucursal Villa Carlos Paz',
  'villa maria': 'Sucursal Villa María',
  'bell ville': 'Sucursal Bell Ville',
  'cruz del eje': 'Sucursal Cruz del Eje',
  'cosquin': 'Sucursal Cosquin',
  'dean funes': 'Sucursal Dean Funes',
  'la calera': 'Sucursal La Calera',
  'villa dolores': 'Sucursal Villa Dolores',
  'manzana historica': 'Manzana Historica',
  'peaje ruta e53 aeropuerto': 'Peaje E53',
  'peaje e53 anexo': 'Peaje Anexo',
  'peaje ruta 5 alta gracia': 'Peaje Ruta 5',
  'peaje ruta 20 carlos paz': 'Peaje Ruta 20',
  'peaje ruta 36 a bouwer': 'Peaje Ruta 36',
  'peaje ruta 9 sur toledo': 'Peaje 9 Sur',
  'peaje cordoba pilar': 'Peaje APC',
  'peaje ruta 9 jesus maria': 'Peaje 9 Norte',
  'peaje ruta 19 monte cristo': 'Peaje Ruta 19',
  'peaje e55 la calera': 'Peaje E55',
  'peaje arroyo tegua': 'Arroyo Tegua',
  'peaje piedras moras': 'Piedras Moras',
  'sede malagueno': 'Obrador Malagueño',
  'malagueno': 'Obrador Malagueño',
  'don bosco': 'Don Bosco',
  'savio': 'Savio',
  'patricio': 'Patricios',
  'valparaiso': 'Valparaíso',
  '20 de junio': '20 de Junio',
  'ituzaingo': 'Ituzaingó',
  'villa allende': 'Villa Allende',
  'loteria casa central': 'Lotería Casa Central',
  'imprenta loteria': 'Lotería Imprenta',
  'casino embalse': 'Casino Embalse',
  'casino miramar': 'Casino Miramar',
  'casino villa maria': 'Casino Villa María',
  'casino mina clavero': 'Casino Mina Clavero',
  'casino rio cuarto': 'Casino Río IV',
  'casino corral de bustos': 'Casino Corral de Bustos',
  'casino laboulaye': 'Casino Laboulaye',
  'casino vcp': 'Casino Carlos Paz',
  'cet rio ceballos': 'CET Río Ceballos',
  'hospital de ninos': 'H. de Niños',
  'hospital misericordia': 'H. Misericordia',
  'hospital san roque nuevo': 'H. San Roque Nuevo',
  'hospital neonatal': 'H. Neonatal',
  'hospital transito': 'H. Transito Caceres',
  'hospital del noreste elpidio torres': 'H. Elpidio Torres',
  'hospital dr emilio vidal abal': 'H. Vidal Abal',
  'hospital materno infantil dr arturo illia': 'H. Materno Infantil',
  'hospital provincial jose maria urritia': 'H. Urrutia',
  'hospital ramon bautista mestre': 'H. Mestre',
  'hospital eva peron': 'H. Eva Perón',
  'hospital oncologico': 'H. Oncológico',
  'hospital zonal oliva': 'H. Oliva',
  'caps ciudad de mis suenos': 'CAPS Ciudad de mis Sueños',
  'caps ciudad de evita manz 53': 'CAPS Ciudad Evita',
  'caps juan pablo segundo': 'CAPS Juan Pablo II',
  'caps mi esperanza': 'CAPS Mi Esperanza',
  'caps parque las rosas': 'CAPS Parque de las Rosas',
  'caps sol naciente': 'CAPS Sol Naciente',
  'caps villa angelelli': 'CAPS Angelelli',
  'barrio zepa c': 'Zepa Anexo',
};

function pickClient(hint) {
  for (const [frag, client] of CLIENT_PREFIX) {
    if (hint.includes(norm(frag))) return client;
  }
  return null;
}

function pickObjectiveName(hint, clientName) {
  for (const [frag, objName] of Object.entries(OBJ_ALIASES)) {
    if (hint.includes(norm(frag))) return objName;
  }
  return null;
}

function score(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;
  const ta = na.split(' '), tb = nb.split(' ');
  let inter = 0;
  for (const t of ta) if (tb.includes(t) && t.length > 2) inter++;
  return inter * 15;
}

async function loadAllObjectives() {
  const snap = await db.collection('clients').get();
  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const st = String(d.status || '').toUpperCase();
    if (st === 'INACTIVE') continue;
    const clientName = d.name || d.razonSocial || doc.id;
    for (const o of (d.objetivos || [])) {
      if (o.status === 'INACTIVE') continue;
      rows.push({
        clientId: doc.id,
        clientName,
        objectiveId: o.id || o.objectiveId,
        objectiveName: o.name || o.nombre || '',
      });
    }
  }
  return rows;
}

function resolveObjective(cc, objectives) {
  const hint = ccHint(cc);
  const clientHint = pickClient(hint);
  const objHint = pickObjectiveName(hint, clientHint);
  let pool = objectives;
  if (clientHint) {
    const filtered = objectives.filter(o => norm(o.clientName).includes(norm(clientHint)) || norm(clientHint).includes(norm(o.clientName)));
    if (filtered.length) pool = filtered;
  }
  let best = null;
  const target = objHint || hint;
  for (const o of pool) {
    const sc = score(target, o.objectiveName);
    if (!best || sc > best.score) best = { ...o, score: sc };
  }
  return { hint, clientHint, objHint, best };
}

async function main() {
  const wb = XLSX.readFile(EXCEL);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const ccList = [...new Set(rows.map(r => String(r.CCosto || '').trim()).filter(Boolean))].sort();
  const objectives = await loadAllObjectives();
  console.log('CCosto únicos:', ccList.length, '| Objetivos CRM:', objectives.length);

  const mapping = {};
  const review = [];
  for (const cc of ccList) {
    const r = resolveObjective(cc, objectives);
    const entry = {
      ccosto: cc,
      clientHint: r.clientHint,
      objectiveHint: r.objHint,
      objectiveId: r.best?.objectiveId || null,
      objectiveName: r.best?.objectiveName || null,
      clientName: r.best?.clientName || null,
      clientId: r.best?.clientId || null,
      score: r.best?.score || 0,
      count: rows.filter(x => String(x.CCosto || '').trim() === cc).length,
    };
    mapping[cc] = entry;
    if (!entry.objectiveId || entry.score < 60) review.push(entry);
  }

  fs.writeFileSync(OUT, JSON.stringify(mapping, null, 2), 'utf8');
  console.log('Escrito', OUT);
  console.log('\nOK (score≥60):', ccList.length - review.length);
  console.log('Revisar:', review.length);
  review.forEach(e => console.log(`[${e.score}] ${e.count}x "${e.ccosto}" → ${e.clientName || '?'} / ${e.objectiveName || '?'}`));
}

main().catch(e => { console.error(e); process.exit(1); });
