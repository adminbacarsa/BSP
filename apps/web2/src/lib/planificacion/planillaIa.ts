/**
 * Arma la grilla anónima que viaja a `interpretarPlanillaIa` y mezcla lo aceptado
 * con la propuesta del lector propio. La IA no escribe sola.
 */
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import type { CuadroPlanilla, FilaPlanilla } from './importarExcel';
import { letraDia, type DiaSemana, type FranjaServicioPlanilla, type PropuestaServicio } from './servicioDesdePlanilla';
import {
  contieneNombrePersona,
  horaIa,
  pareceNombrePersona,
  sanearGrilla,
  sanearTexto,
  validarLecturaIa,
  type ExcepcionDiaIa,
  type GrillaPlanillaIa,
  type LecturaPlanillaIa,
  type LeyendaIa,
} from '../../../../functions/src/planificacion/planillaIaCore';

export {
  contieneNombrePersona,
  pareceNombrePersona,
  sanearTexto,
  validarLecturaIa,
  type GrillaPlanillaIa,
  type LecturaPlanillaIa,
};

export type ClaseIa = 'coincidencia' | 'diferencia' | 'agregado';

export type ItemComparacionIa = {
  id: string;
  clase: ClaseIa;
  titulo: string;
  lector: string;
  ia: string;
  confianza: number;
  aceptable: boolean;
};

export type PropuestaAceptadaIa = {
  franjas: FranjaServicioPlanilla[];
  equivalencias: EquivalenciaCodigo[];
  funciones: string[];
};

function norm(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function esNota(fila: FilaPlanilla): boolean {
  if (String(fila.legajo || '').trim()) return false;
  const dias = fila.celdas.filter((c) => String(c.raw || '').trim());
  if (!dias.length) return false;
  const notas = dias.filter((c) => /\d+\s*A\s*\d+/i.test(String(c.raw)));
  return notas.length >= Math.ceil(dias.length / 2);
}

export function armarGrillaIa(cuadro: CuadroPlanilla, year: number, month: number): GrillaPlanillaIa {
  const celdas: GrillaPlanillaIa['celdas'] = [];
  const notas: GrillaPlanillaIa['notas'] = [];
  const bloques: GrillaPlanillaIa['bloquesPuesto'] = [];
  const dotacion: GrillaPlanillaIa['dotacion'] = [];
  for (const fila of cuadro.filas) {
    const puesto = sanearTexto(String(fila.puesto || '').trim(), `fila ${fila.fila}`);
    const legajo = String(fila.legajo || '').trim();
    if (/^[\d.\-]+$/.test(legajo)) dotacion.push({ fila: fila.fila, etiqueta: `fila ${fila.fila}`, legajo });
    else dotacion.push({ fila: fila.fila, etiqueta: `fila ${fila.fila}` });
    if (esNota(fila)) {
      const texto = fila.celdas
        .filter((c) => String(c.raw || '').trim())
        .map((c) => `día ${c.dia}: ${sanearTexto(String(c.raw), `fila ${fila.fila}`)}`)
        .join(' · ')
        .slice(0, 500);
      if (texto) notas.push({ fila: fila.fila, texto });
      continue;
    }
    if (puesto) {
      const ultimo = bloques[bloques.length - 1];
      if (ultimo && ultimo.nombre === puesto && ultimo.hasta === fila.fila - 1) ultimo.hasta = fila.fila;
      else bloques.push({ nombre: puesto, desde: fila.fila, hasta: fila.fila });
    }
    for (const celda of fila.celdas) {
      const texto = sanearTexto(String(celda.raw ?? '').trim(), `fila ${fila.fila}`);
      if (!texto) continue;
      const item: GrillaPlanillaIa['celdas'][number] = { fila: fila.fila, col: celda.dia, texto };
      if (celda.color && celda.color !== 'none') item.fondo = String(celda.color).slice(0, 32);
      celdas.push(item);
    }
  }
  const combinadas = bloques
    .filter((b) => b.hasta > b.desde)
    .map((b) => ({ fila: b.desde, col: 0, filas: b.hasta - b.desde + 1, cols: 1 }));
  return sanearGrilla({
    year,
    month,
    titulo: sanearTexto(cuadro.titulo || '', 'fila'),
    celdas,
    combinadas,
    bloquesPuesto: bloques,
    notas,
    dotacion,
    referencias: cuadro.referencias.map((r) => ({
      codigo: sanearTexto(r.codigo, 'fila'),
      desc: sanearTexto(r.desc || '', 'fila'),
      inicio: r.inicio,
      fin: r.fin,
      color: r.color && r.color !== 'none' ? String(r.color) : undefined,
    })),
  });
}

function codigoServicio(item: LeyendaIa): string {
  return (item.banda || item.codigo || '').toUpperCase();
}

function buscarFranja(franjas: readonly FranjaServicioPlanilla[], puesto: string, code: string): FranjaServicioPlanilla | undefined {
  const p = norm(puesto);
  const c = code.toUpperCase();
  const delPuesto = franjas.filter((f) => norm(f.puesto) === p && f.code.toUpperCase() === c);
  if (delPuesto.length) return delPuesto[0];
  if (!p) {
    const porCodigo = franjas.filter((f) => f.code.toUpperCase() === c);
    if (porCodigo.length === 1) return porCodigo[0];
  }
  return undefined;
}

function horario(inicio: string, fin: string): string {
  return `${inicio}–${fin}`;
}

const NO_BANDA = new Set(['FRANCO', 'EVENTO', 'LICENCIA', 'RETEN', 'OTRO_OBJETIVO']);

export function compararLecturaIa(propuesta: PropuestaServicio, lectura: LecturaPlanillaIa): ItemComparacionIa[] {
  const items: ItemComparacionIa[] = [];
  lectura.leyenda.forEach((item, i) => {
    const code = codigoServicio(item);
    const ia = `${item.puesto ? `${item.puesto} · ` : ''}${code} ${horario(item.inicio, item.fin)}${item.color ? ` · ${item.color}` : ''} · ${item.tipo}`;
    if (NO_BANDA.has(item.tipo)) {
      const creoPuesto = propuesta.franjas.some((f) => norm(f.puesto) === norm(item.puesto || item.codigo) || f.code.toUpperCase() === item.tipo);
      items.push({
        id: `leyenda:${i}`,
        clase: creoPuesto ? 'diferencia' : 'coincidencia',
        titulo: item.tipo === 'RETEN' ? 'RETEN no es un puesto' : `${item.codigo} no arma franja`,
        lector: creoPuesto ? 'El lector lo tomó como puesto o franja' : 'El lector tampoco lo toma como puesto',
        ia,
        confianza: item.confianza,
        aceptable: creoPuesto,
      });
      return;
    }
    const franja = buscarFranja(propuesta.franjas, item.puesto || '', code);
    if (!franja) {
      items.push({
        id: `leyenda:${i}`,
        clase: 'agregado',
        titulo: `${item.puesto || 'Sin puesto'} · ${code}`,
        lector: 'El lector no armó esta franja',
        ia,
        confianza: item.confianza,
        aceptable: true,
      });
      return;
    }
    const mismasHoras = horaIa(franja.startTime) === item.inicio && horaIa(franja.endTime) === item.fin;
    items.push({
      id: `leyenda:${i}`,
      clase: mismasHoras ? 'coincidencia' : 'diferencia',
      titulo: `${franja.puesto} · ${franja.code}`,
      lector: `${franja.puesto} · ${franja.code} ${horario(franja.startTime, franja.endTime)}`,
      ia,
      confianza: item.confianza,
      aceptable: !mismasHoras,
    });
  });

  lectura.funciones.forEach((item, i) => {
    const texto = `${item.nombre}: cubre ${item.cubre.join(' y ')}`;
    const ya = (propuesta.funciones || []).some((f) => norm(f).includes(norm(item.nombre)));
    const comoPuesto = propuesta.franjas.some((f) => norm(f.puesto) === norm(item.nombre));
    items.push({
      id: `funcion:${i}`,
      clase: ya && !comoPuesto ? 'coincidencia' : comoPuesto ? 'diferencia' : 'agregado',
      titulo: item.nombre,
      lector: ya ? (propuesta.funciones || []).find((f) => norm(f).includes(norm(item.nombre))) || '' : 'El lector no la marcó como función',
      ia: texto,
      confianza: item.confianza,
      aceptable: !ya || comoPuesto,
    });
  });

  lectura.excepcionesPorDia.forEach((item, i) => {
    const franja = propuesta.franjas.find((f) => f.code.toUpperCase() === item.codigo.toUpperCase() && horaIa(f.startTime) === item.inicio && horaIa(f.endTime) === item.fin);
    items.push({
      id: `excepcion:${i}`,
      clase: franja ? 'coincidencia' : 'agregado',
      titulo: `Día ${item.dia} · ${item.codigo}`,
      lector: franja ? `${franja.puesto} · ${franja.code} ${horario(franja.startTime, franja.endTime)}` : 'El lector no separó este día',
      ia: `${item.codigo} ${horario(item.inicio, item.fin)} · ${item.fuente}`,
      confianza: item.confianza,
      aceptable: !franja,
    });
  });
  return items;
}

function diasDeExcepciones(items: ExcepcionDiaIa[], year: number, month: number): DiaSemana[] {
  const set = new Set<DiaSemana>();
  for (const item of items) set.add(letraDia(year, month, item.dia));
  const orden: DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  return orden.filter((d) => set.has(d));
}

function quitarPuesto(franjas: FranjaServicioPlanilla[], nombre: string): FranjaServicioPlanilla[] {
  const n = norm(nombre);
  if (!n) return franjas;
  return franjas.filter((f) => norm(f.puesto) !== n);
}

export function aplicarAceptadas(
  propuesta: PropuestaServicio,
  lectura: LecturaPlanillaIa,
  ids: readonly string[],
  year: number,
  month: number,
): PropuestaAceptadaIa {
  const aceptadas = new Set(ids);
  let franjas = propuesta.franjas.map((f) => ({ ...f, dias: [...f.dias] }));
  const equivalencias = propuesta.equivalencias.map((e) => ({ ...e }));
  let funciones = [...(propuesta.funciones || [])];

  const excepcionesAceptadas = lectura.excepcionesPorDia.filter((_, i) => aceptadas.has(`excepcion:${i}`));

  lectura.leyenda.forEach((item, i) => {
    if (!aceptadas.has(`leyenda:${i}`)) return;
    if (NO_BANDA.has(item.tipo)) {
      franjas = quitarPuesto(franjas, item.puesto || item.codigo);
      return;
    }
    const code = codigoServicio(item);
    const puesto = item.puesto || franjas.find((f) => f.code.toUpperCase() === code)?.puesto || 'Puesto';
    const relacionadas = excepcionesAceptadas.filter((e) => e.codigo.toUpperCase() === item.codigo.toUpperCase() && e.inicio === item.inicio && e.fin === item.fin);
    const dias = diasDeExcepciones(relacionadas, year, month);
    const existe = buscarFranja(franjas, puesto, code);
    if (existe) {
      existe.startTime = item.inicio;
      existe.endTime = item.fin;
      if (dias.length) existe.dias = dias;
    } else {
      franjas.push({
        id: `ia_${norm(puesto).replace(/\s+/g, '_')}_${code}_${item.inicio}`,
        puesto,
        code,
        startTime: item.inicio,
        endTime: item.fin,
        cantidad: 1,
        dias,
      });
    }
    const rojo = /red|ff0000/i.test(item.color || '');
    const clave = claveEquivalencia(item.codigo, rojo);
    const eq: EquivalenciaCodigo = {
      clave,
      codigo: item.codigo,
      color: rojo ? 'red' : 'none',
      code,
      startTime: item.inicio,
      endTime: item.fin,
      muestras: 1,
      positionName: puesto,
    };
    const idx = equivalencias.findIndex((e) => e.clave === clave);
    if (idx >= 0) equivalencias[idx] = { ...equivalencias[idx], ...eq, muestras: Math.max(equivalencias[idx].muestras, 1) };
    else equivalencias.push(eq);
  });

  lectura.funciones.forEach((item, i) => {
    if (!aceptadas.has(`funcion:${i}`)) return;
    franjas = quitarPuesto(franjas, item.nombre);
    const texto = `${item.nombre}: cubre ${item.cubre.join(' y ')}`;
    if (!funciones.some((f) => norm(f).includes(norm(item.nombre)))) funciones.push(texto);
  });

  excepcionesAceptadas.forEach((item) => {
    const dia = letraDia(year, month, item.dia);
    const existe = franjas.find((f) => f.code.toUpperCase() === item.codigo.toUpperCase() && horaIa(f.startTime) === item.inicio && horaIa(f.endTime) === item.fin);
    if (existe) {
      if (existe.dias.length && !existe.dias.includes(dia)) existe.dias = [...existe.dias, dia];
      return;
    }
    const puesto = franjas.find((f) => f.code.toUpperCase() === item.codigo.toUpperCase())?.puesto || 'Puesto';
    franjas.push({
      id: `ia_dia_${item.dia}_${item.codigo}_${item.inicio}`,
      puesto,
      code: item.codigo.toUpperCase(),
      startTime: item.inicio,
      endTime: item.fin,
      cantidad: 1,
      dias: [dia],
    });
  });

  return { franjas, equivalencias, funciones };
}
