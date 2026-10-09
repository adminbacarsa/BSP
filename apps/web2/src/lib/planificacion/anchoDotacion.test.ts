import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHO_ANCHA,
  ANCHO_COMPACTA,
  ANCHO_MAX,
  ANCHO_MIN,
  abreviarNombreGuardia,
  anchoAutoDotacion,
  anchoCajaNombre,
  anchoContenidoFila,
  anchoTextoNombre,
  anchosEnVista,
  claveAnchoDotacion,
  clampAnchoDotacion,
  guardarAnchoDotacion,
  leerAnchoDotacion,
} from './anchoDotacion';

const NAVARRO = 'NAVARRO ASTRADA, ROXANA GABRIELA';
const NAVARRO_INI = 'NAVARRO ASTRADA, R. G.';
const NAVARRO_CORTO = 'NAVARRO A., R. G.';

test('el ancho queda entre 160 y 520', () => {
  assert.equal(clampAnchoDotacion(100), ANCHO_MIN);
  assert.equal(clampAnchoDotacion(900), ANCHO_MAX);
  assert.equal(clampAnchoDotacion(Number.NaN), ANCHO_ANCHA);
  assert.equal(clampAnchoDotacion(240.4), 240);
  assert.ok(ANCHO_COMPACTA >= ANCHO_MIN && ANCHO_COMPACTA <= ANCHO_MAX);
  assert.ok(ANCHO_ANCHA >= ANCHO_MIN && ANCHO_ANCHA <= ANCHO_MAX);
});

test('auto usa el contenido más ancho y no pasa el máximo', () => {
  assert.equal(anchoAutoDotacion([]), ANCHO_ANCHA);
  assert.equal(anchoAutoDotacion([180, 240, 200]), 240);
  assert.equal(anchoAutoDotacion([100, 800]), ANCHO_MAX);
  assert.equal(anchoAutoDotacion([Number.NaN, 0]), ANCHO_ANCHA);
});

test('auto mide solo las filas visibles', () => {
  const filas = [
    { top: 0, bottom: 40, ancho: 300 },
    { top: 40, bottom: 80, ancho: 480 },
    { top: 400, bottom: 440, ancho: 200 },
  ];
  assert.deepEqual(anchosEnVista(filas, 0, 100), [300, 480]);
  assert.equal(anchoAutoDotacion(anchosEnVista(filas, 0, 100)), 480);
});

test('abreviar: apellido completo e iniciales, sin «de los»', () => {
  assert.equal(abreviarNombreGuardia(NAVARRO, anchoTextoNombre(NAVARRO)), NAVARRO);
  assert.equal(abreviarNombreGuardia(NAVARRO, anchoTextoNombre(NAVARRO_INI)), NAVARRO_INI);
  assert.equal(abreviarNombreGuardia('OLIVERA, MARIA DE LOS ANGELES', anchoTextoNombre('OLIVERA, M. A.')), 'OLIVERA, M. A.');
  assert.equal(abreviarNombreGuardia('SCHOOP, JORGELINA NAYLA IVON', anchoTextoNombre('SCHOOP, J. N. I.')), 'SCHOOP, J. N. I.');
});

test('si las iniciales no entran, el segundo apellido pasa a inicial y al final van puntos', () => {
  assert.equal(abreviarNombreGuardia(NAVARRO, anchoTextoNombre(NAVARRO_CORTO)), NAVARRO_CORTO);
  const recortado = abreviarNombreGuardia(NAVARRO, 40);
  assert.ok(recortado.endsWith('…'), recortado);
  assert.ok(recortado.length < NAVARRO_CORTO.length);
});

test('en ancha el nombre largo entra; en compacta se abrevia', () => {
  const flags = { conPuesto: true, conHoras: true, conKm: true, conPuntaje: true };
  const enAncha = abreviarNombreGuardia(NAVARRO, anchoCajaNombre(ANCHO_ANCHA, flags));
  assert.equal(enAncha, NAVARRO);
  const enCompacta = abreviarNombreGuardia(NAVARRO, anchoCajaNombre(ANCHO_COMPACTA, { ...flags, compacta: true }));
  assert.equal(enCompacta, NAVARRO_INI);
  assert.ok(anchoContenidoFila(NAVARRO, flags) > ANCHO_COMPACTA);
  assert.ok(anchoContenidoFila(NAVARRO, flags) <= ANCHO_MAX);
});

test('se recuerda por vista y un almacenamiento roto no tira', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  assert.equal(claveAnchoDotacion('agrupada'), 'cosp-planif-ancho-dotacion:agrupada');
  assert.equal(leerAnchoDotacion(storage, 'agrupada').modo, 'ancha');
  guardarAnchoDotacion(storage, 'agrupada', { modo: 'compacta', ancho: 90, presentacion: 'compacta' });
  guardarAnchoDotacion(storage, 'objetivo', { modo: 'manual', ancho: 310, presentacion: 'completa' });
  const agrupada = leerAnchoDotacion(storage, 'agrupada');
  assert.equal(agrupada.modo, 'compacta');
  assert.equal(agrupada.ancho, ANCHO_MIN);
  assert.equal(agrupada.presentacion, 'compacta');
  assert.equal(leerAnchoDotacion(storage, 'objetivo').ancho, 310);
  assert.equal(leerAnchoDotacion(storage, 'objetivo').presentacion, 'completa');

  const roto = {
    getItem: () => { throw new Error('privado'); },
    setItem: () => { throw new Error('lleno'); },
  };
  assert.equal(leerAnchoDotacion(roto, 'agrupada').modo, 'ancha');
  assert.doesNotThrow(() => guardarAnchoDotacion(roto, 'objetivo', { modo: 'auto', ancho: 300, presentacion: 'completa' }));
  assert.equal(leerAnchoDotacion({ getItem: () => '{' }, 'agrupada').modo, 'ancha');
});
