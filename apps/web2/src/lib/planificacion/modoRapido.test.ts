import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    autorizacionesAlGuardar,
    avisosModoRapido,
    continuarPatron,
    crearHistorial,
    descansoEntre,
    deshacer,
    detectarCiclo,
    horarioDeCodigo,
    matrizATsv,
    moverCursor,
    normalizarRango,
    parsearTsv,
    planPegado,
    planRelleno,
    planSerie,
    registrarCambio,
    rehacer,
    sugerirCodigos,
    tipoDeCodigo,
} from './modoRapido';

const DIMS = { filas: 20, cols: 31 };

describe('modo rápido · cursor', () => {
    it('flechas con tope en los bordes', () => {
        assert.deepEqual(moverCursor({ r: 0, c: 0 }, 'ArrowUp', {}, DIMS), { r: 0, c: 0 });
        assert.deepEqual(moverCursor({ r: 3, c: 4 }, 'ArrowRight', {}, DIMS), { r: 3, c: 5 });
        assert.deepEqual(moverCursor({ r: 19, c: 30 }, 'ArrowDown', {}, DIMS), { r: 19, c: 30 });
    });
    it('Tab y Shift+Tab pasan de fila al llegar al borde', () => {
        assert.deepEqual(moverCursor({ r: 2, c: 30 }, 'Tab', {}, DIMS), { r: 3, c: 0 });
        assert.deepEqual(moverCursor({ r: 3, c: 0 }, 'Tab', { shift: true }, DIMS), { r: 2, c: 30 });
        assert.deepEqual(moverCursor({ r: 19, c: 30 }, 'Tab', {}, DIMS), { r: 19, c: 30 });
    });
    it('Enter baja, Shift+Enter sube; Inicio/Fin al primer y último día', () => {
        assert.deepEqual(moverCursor({ r: 5, c: 5 }, 'Enter', {}, DIMS), { r: 6, c: 5 });
        assert.deepEqual(moverCursor({ r: 5, c: 5 }, 'Enter', { shift: true }, DIMS), { r: 4, c: 5 });
        assert.deepEqual(moverCursor({ r: 5, c: 5 }, 'Home', {}, DIMS), { r: 5, c: 0 });
        assert.deepEqual(moverCursor({ r: 5, c: 5 }, 'End', {}, DIMS), { r: 5, c: 30 });
        assert.deepEqual(moverCursor({ r: 5, c: 5 }, 'End', { ctrl: true }, DIMS), { r: 19, c: 30 });
    });
    it('Ctrl+flecha salta al borde del bloque como Excel', () => {
        const fila = ['M', 'M', 'M', '', '', 'T', 'T'];
        const ocupada = (_r: number, c: number) => !!fila[c];
        const d = { filas: 1, cols: 7 };
        assert.deepEqual(moverCursor({ r: 0, c: 0 }, 'ArrowRight', { ctrl: true }, d, ocupada), { r: 0, c: 2 });
        assert.deepEqual(moverCursor({ r: 0, c: 2 }, 'ArrowRight', { ctrl: true }, d, ocupada), { r: 0, c: 5 });
        assert.deepEqual(moverCursor({ r: 0, c: 5 }, 'ArrowRight', { ctrl: true }, d, ocupada), { r: 0, c: 6 });
        assert.deepEqual(moverCursor({ r: 0, c: 3 }, 'ArrowRight', { ctrl: true }, d, () => false), { r: 0, c: 6 });
        assert.deepEqual(moverCursor({ r: 4, c: 4 }, 'ArrowUp', { ctrl: true }, DIMS), { r: 0, c: 4 });
    });
    it('una tecla que no mueve devuelve null', () => {
        assert.equal(moverCursor({ r: 0, c: 0 }, 'm', {}, DIMS), null);
    });
});

describe('modo rápido · pegado TSV', () => {
    it('parsea Excel con CRLF, vacíos y minúsculas', () => {
        const m = parsearTsv('m\tm\tf\r\nt\t\tn12\r\n');
        assert.deepEqual(m, [['M', 'M', 'F'], ['T', '', 'N12']]);
        assert.equal(matrizATsv(m), 'M\tM\tF\nT\t\tN12');
        assert.deepEqual(parsearTsv(''), []);
    });
    it('pega desde la celda activa y corta en los bordes', () => {
        const plan = planPegado([['M', 'T'], ['N', 'F']], { r: 19, c: 29 }, DIMS);
        assert.deepEqual(plan.map((p) => `${p.r}:${p.c}=${p.valor}`), ['19:29=M', '19:30=T']);
    });
    it('un 1×1 o un bloque que entra justo se repite en el rango destino', () => {
        const rg = normalizarRango({ r: 0, c: 0 }, { r: 1, c: 3 });
        const plan = planPegado([['M', 'F']], { r: 0, c: 0 }, DIMS, rg);
        assert.equal(plan.length, 8);
        assert.deepEqual(plan.filter((p) => p.r === 1).map((p) => p.valor), ['M', 'F', 'M', 'F']);
    });
});

describe('modo rápido · patrón y relleno', () => {
    it('detecta el ciclo 6x2 y lo continúa en fase', () => {
        const seq = ['M', 'M', 'M', 'M', 'M', 'M', 'F', 'F'];
        assert.equal(detectarCiclo(seq), 8);
        assert.deepEqual(continuarPatron(seq, 10), ['M', 'M', 'M', 'M', 'M', 'M', 'F', 'F', 'M', 'M']);
        const conFase = [...seq, 'M', 'M'];
        assert.equal(detectarCiclo(conFase), 8);
        assert.deepEqual(continuarPatron(conFase, 6), ['M', 'M', 'M', 'M', 'F', 'F']);
    });
    it('un solo valor se repite; M T se alterna', () => {
        assert.deepEqual(continuarPatron(['N'], 3), ['N', 'N', 'N']);
        assert.deepEqual(continuarPatron(['M', 'T'], 3), ['M', 'T', 'M']);
    });
    it('tirador de relleno hacia la derecha y hacia abajo', () => {
        const val = (_r: number, c: number) => (['M', 'M', 'F'][c] || '');
        const der = planSerie(normalizarRango({ r: 0, c: 0 }, { r: 0, c: 2 }), { r: 0, c: 6 }, val)!;
        assert.equal(der.direccion, 'derecha');
        assert.deepEqual(der.pares.map((p) => p.desde.c), [0, 1, 2, 0]);
        assert.deepEqual(der.pares.map((p) => p.hacia.c), [3, 4, 5, 6]);
        const abajo = planSerie(normalizarRango({ r: 0, c: 0 }), { r: 3, c: 0 }, () => 'T')!;
        assert.equal(abajo.direccion, 'abajo');
        assert.equal(abajo.pares.length, 3);
        assert.equal(planSerie(normalizarRango({ r: 2, c: 2 }), { r: 1, c: 1 }, () => 'M'), null);
    });
    it('Ctrl+D copia la primera fila del rango; con una celda copia la de arriba', () => {
        const d = planRelleno(normalizarRango({ r: 0, c: 0 }, { r: 2, c: 1 }), 'abajo');
        assert.equal(d.length, 4);
        assert.ok(d.every((p) => p.desde.r === 0));
        const uno = planRelleno(normalizarRango({ r: 3, c: 5 }), 'abajo');
        assert.deepEqual(uno, [{ desde: { r: 2, c: 5 }, hacia: { r: 3, c: 5 } }]);
        const r = planRelleno(normalizarRango({ r: 0, c: 2 }, { r: 0, c: 5 }), 'derecha');
        assert.ok(r.every((p) => p.desde.c === 2) && r.length === 3);
        assert.deepEqual(planRelleno(normalizarRango({ r: 0, c: 0 }), 'derecha'), []);
    });
});

describe('modo rápido · deshacer y rehacer', () => {
    it('deshace y rehace en orden; un cambio nuevo borra lo rehacible', () => {
        let h = crearHistorial<number>(3);
        h = registrarCambio(h, 0);
        h = registrarCambio(h, 1);
        const u = deshacer(h, 2)!;
        assert.equal(u.estado, 1);
        const r = rehacer(u.h, 1)!;
        assert.equal(r.estado, 2);
        const u2 = deshacer(r.h, 2)!;
        const nuevo = registrarCambio(u2.h, 1);
        assert.equal(rehacer(nuevo, 5), null);
        let lleno = crearHistorial<number>(2);
        for (const v of [1, 2, 3]) lleno = registrarCambio(lleno, v);
        assert.deepEqual(lleno.atras, [2, 3]);
        assert.equal(deshacer(crearHistorial<number>(), 0), null);
    });
});

describe('modo rápido · códigos y horario', () => {
    it('autocompletar: exacto primero, después por prefijo y sin repetir', () => {
        const ops = [{ code: 'N12' }, { code: 'N' }, { code: 'M' }, { code: 'N' }, { code: 'NX' }];
        assert.deepEqual(sugerirCodigos('n', ops).map((o) => o.code), ['N', 'N12', 'NX']);
        assert.deepEqual(sugerirCodigos('', ops, 2).map((o) => o.code), ['N12', 'N']);
    });
    it('horario: SLA del puesto, estándar, último usado; código desconocido = null', () => {
        const sla = [{ code: 'M', startTime: '06:00', endTime: '14:00', hours: 8, positionName: 'Puesto 1' }];
        assert.equal(horarioDeCodigo('m', { slaPuesto: sla })?.startTime, '06:00');
        assert.equal(horarioDeCodigo('M', { slaPuesto: sla })?.fuente, 'SLA');
        assert.equal(horarioDeCodigo('N12', {})?.startTime, '19:00');
        assert.equal(horarioDeCodigo('N12', {})?.hours, 12);
        const ult = horarioDeCodigo('P1M', { ultimoUsado: { P1M: { startTime: '08:00', endTime: '14:00' } } });
        assert.equal(ult?.fuente, 'ULTIMO');
        assert.equal(ult?.hours, 6);
        assert.equal(horarioDeCodigo('ZZ', {}), null);
    });
    it('tipo de código', () => {
        assert.equal(tipoDeCodigo('ff'), 'FRANCO');
        assert.equal(tipoDeCodigo('V'), 'LICENCIA');
        assert.equal(tipoDeCodigo('AA'), 'LICENCIA');
        assert.equal(tipoDeCodigo('RET'), 'RET');
        assert.equal(tipoDeCodigo('ESC'), 'DESPLIEGUE');
        assert.equal(tipoDeCodigo('D12'), 'TRABAJO');
    });
});

describe('modo rápido · avisos', () => {
    const turnos: Record<string, { code: string; startTime: string; endTime: string; trabajo: boolean }> = {
        'g1_2026-10-01': { code: 'T', startTime: '15:00', endTime: '23:00', trabajo: true },
        'g1_2026-10-02': { code: 'M', startTime: '07:00', endTime: '15:00', trabajo: true },
        'g1_2026-10-03': { code: 'N', startTime: '23:00', endTime: '07:00', trabajo: true },
    };
    it('descanso entre turnos con cruce de medianoche', () => {
        assert.equal(descansoEntre(turnos['g1_2026-10-01'], turnos['g1_2026-10-02']), 8);
        assert.equal(descansoEntre(turnos['g1_2026-10-03'], { code: 'M', startTime: '07:00', endTime: '15:00', trabajo: true }), 0);
        assert.equal(descansoEntre(turnos['g1_2026-10-03'], { code: 'T', startTime: '15:00', endTime: '23:00', trabajo: true }), 8);
    });
    it('marca descanso, licencia, solape y tope; al guardar separa lo que bloquea de lo que pide PIN', () => {
        const avisos = avisosModoRapido({
            filas: [{ id: 'g1', nombre: 'BAEZ' }, { id: 'g2', nombre: 'FARIAS' }],
            dias: ['2026-10-01', '2026-10-02', '2026-10-03'],
            claves: new Set(['g1_2026-10-02', 'g2_2026-10-01']),
            turnoDe: (e, d) => turnos[`${e}_${d}`] || (e === 'g2' && d === '2026-10-01' ? { code: 'M', startTime: '07:00', endTime: '15:00', trabajo: true } : null),
            licenciaDe: (e, d) => (e === 'g2' && d === '2026-10-01' ? 'V' : null),
            ajenoDe: (e, d) => (e === 'g1' && d === '2026-10-02' ? 'Peaje 9' : null),
            horasMes: (e) => (e === 'g1' ? 208 : 40),
            tope: 200,
        });
        const tipos = avisos.map((a) => a.tipo).sort();
        assert.deepEqual(tipos, ['DESCANSO', 'LICENCIA', 'SOLAPE', 'TOPE']);
        const d = avisos.find((a) => a.tipo === 'DESCANSO')!;
        assert.equal(d.restHours, 8);
        assert.equal(d.dateStr, '2026-10-02');
        const g = autorizacionesAlGuardar([...avisos, { ...d, restHours: 6 }]);
        assert.equal(g.bloquean.length, 1);
        assert.equal(g.piden.length, 2);
    });
    it('el tope autorizado no avisa', () => {
        const avisos = avisosModoRapido({
            filas: [{ id: 'g1', nombre: 'BAEZ' }],
            dias: ['2026-10-01'],
            claves: new Set(['g1_2026-10-01']),
            turnoDe: () => null,
            licenciaDe: () => null,
            ajenoDe: () => null,
            horasMes: () => 210,
            tope: 200,
            topeAutorizado: () => true,
        });
        assert.equal(avisos.length, 0);
    });
});
