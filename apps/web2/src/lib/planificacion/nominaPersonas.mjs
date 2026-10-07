/**
 * Una fila por persona en la nómina del modal de cobertura.
 * Dos legajos o dos turnos del mismo día no se listan dos veces.
 */

const RANK = { RETEN: 0, ESC: 1, FREE: 2, FRANCO: 3, WORKING: 8, LICENCIA: 9 };

export function normalizarNombrePersona(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nombreDe(p) {
  return normalizarNombrePersona(p?.name || p?.nombre || '');
}

function rolDe(p) {
  return String(p?.dayRole || p?.role || '');
}

export function clavesPersonaNomina(p, indice = 0) {
  const claves = [];
  const id = String(p?.id || '').trim();
  if (id) claves.push(`id:${id}`);
  const uid = String(p?.uid || '').trim();
  if (uid) claves.push(`uid:${uid}`);
  const dni = String(p?.dni || '').replace(/\D/g, '');
  if (dni.length >= 7) claves.push(`dni:${dni}`);
  const cuil = String(p?.cuil || p?.bolsaCuil || '').replace(/\D/g, '');
  if (cuil.length === 11) claves.push(`cuil:${cuil}`);
  const nombre = nombreDe(p);
  if (nombre) claves.push(`nom:${nombre}`);
  return claves.length ? claves : [`fila:${indice}`];
}

function rank(p) {
  const n = RANK[rolDe(p)];
  return n == null ? 5 : n;
}

/**
 * Conserva el orden de la primera aparición y, si hay duplicado, el rol más útil
 * (Retén, ESC, libre, franco) y, a igual rol, el de menos km.
 */
export function dedupeNomina(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const parent = list.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const vistos = new Map();
  list.forEach((row, i) => {
    for (const clave of clavesPersonaNomina(row, i)) {
      if (vistos.has(clave)) union(i, vistos.get(clave));
      else vistos.set(clave, i);
    }
  });
  const grupos = new Map();
  list.forEach((row, i) => {
    const raiz = find(i);
    const grupo = grupos.get(raiz);
    if (grupo) grupo.push(row);
    else grupos.set(raiz, [row]);
  });
  const vistosRaiz = new Set();
  const out = [];
  list.forEach((row, i) => {
    const raiz = find(i);
    if (vistosRaiz.has(raiz)) return;
    vistosRaiz.add(raiz);
    const grupo = grupos.get(raiz) || [row];
    const mejor = grupo.slice().sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      return (Number(a.km) || 9999) - (Number(b.km) || 9999);
    })[0];
    out.push(mejor);
  });
  return out;
}
