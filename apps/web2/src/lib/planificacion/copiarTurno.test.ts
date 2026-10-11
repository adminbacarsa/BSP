import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planRelleno, planSerie, normalizarRango } from './modoRapido';
import { resolverTurnoCopiado, type FuenteTurno, type PuestoServicio } from './copiarTurno';
import { armarFilasVentana, armarPortapapeles, columnasCrono } from './cronoVentana';

const puestos: PuestoServicio[] = [
    { positionName: 'Puesto 1', shifts: [{ code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 }, { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 }] },
    { positionName: 'Puesto 2', shifts: [{ code: 'M', name: 'Mañana', startTime: '06:00', endTime: '14:00', hours: 8 }, { code: 'R1', name: 'Rondín', startTime: '08:00', endTime: '12:00', hours: 4 }] },
];

const mPuesto2: FuenteTurno = { code: 'M', name: 'Mañana', positionName: 'Puesto 2', startTime: '06:00', endTime: '14:00', hours: 8 };

function pegar(fuente: FuenteTurno | null, puestoDestino: string, mes = 'octubre') {
    if (!fuente) return null;
    return resolverTurnoCopiado({ fuente, puestoDestino, nombreDestino: 'Regalo, Juan', mesLabel: mes, puestos });
}

describe('copiar el turno del puesto', () => {
    it('pegar, rellenar y el tirador conservan el puesto y el horario de la celda origen', () => {
        const pegado = pegar(mPuesto2, 'Puesto 1');
        assert.equal(pegado?.positionName, 'Puesto 2');
        assert.equal(pegado?.startTime, '06:00');
        assert.equal(pegado?.endTime, '14:00');
        assert.equal(pegado?.code, 'M');
        assert.deepEqual(pegado?.avisos, ['REGALO tomó un turno de Puesto 2']);

        const grilla: FuenteTurno[][] = [
            [mPuesto2, { code: 'T', positionName: 'Puesto 2', startTime: '14:00', endTime: '22:00', hours: 8 }],
            [null as unknown as FuenteTurno, null as unknown as FuenteTurno],
        ];
        const relleno = planRelleno(normalizarRango({ r: 0, c: 0 }, { r: 1, c: 1 }), 'abajo');
        for (const p of relleno) {
            const src = grilla[p.desde.r][p.desde.c];
            const out = pegar(src, 'Puesto 1');
            assert.equal(out?.positionName, src.positionName);
            assert.equal(out?.startTime, src.startTime);
            assert.equal(out?.endTime, src.endTime);
        }

        const serie = planSerie(normalizarRango({ r: 0, c: 0 }, { r: 0, c: 1 }), { r: 0, c: 3 }, (r, c) => grilla[r]?.[c]?.code || '')!;
        assert.equal(serie.pares.length, 2);
        for (const p of serie.pares) {
            const src = grilla[p.desde.r][p.desde.c];
            const out = pegar(src, 'Puesto 1');
            assert.equal(out?.code, src.code);
            assert.equal(out?.positionName, 'Puesto 2');
            assert.equal(out?.startTime, src.startTime);
        }
    });

    it('un código propio del puesto viaja con su horario', () => {
        const out = pegar({ code: 'R1', name: 'Rondín', positionName: 'Puesto 2', startTime: '08:00', endTime: '12:00', hours: 4 }, 'Puesto 1');
        assert.equal(out?.code, 'R1');
        assert.equal(out?.positionName, 'Puesto 2');
        assert.equal(out?.startTime, '08:00');
        assert.equal(out?.endTime, '12:00');
    });

    it('si el puesto no está en el mes destino, usa el puesto del guardia y avisa', () => {
        const soloUno = puestos.filter((p) => p.positionName === 'Puesto 1');
        const out = resolverTurnoCopiado({
            fuente: mPuesto2,
            puestoDestino: 'Puesto 1',
            nombreDestino: 'Regalo, Juan',
            mesLabel: 'noviembre',
            puestos: soloUno,
        });
        assert.equal(out?.positionName, 'Puesto 1');
        assert.equal(out?.startTime, '07:00');
        assert.equal(out?.endTime, '15:00');
        assert.deepEqual(out?.avisos, ['Puesto 2 no está en el servicio de noviembre: se usó Puesto 1']);
    });

    it('el mismo puesto por defecto no avisa, y sin puesto en la fuente no pisa el camino de Excel', () => {
        const mismo = pegar(mPuesto2, 'Puesto 2');
        assert.equal(mismo?.positionName, 'Puesto 2');
        assert.deepEqual(mismo?.avisos, []);
        assert.equal(pegar({ code: 'M', startTime: '07:00', endTime: '15:00' }, 'Puesto 1'), null);
    });

    it('sin puesto por defecto no avisa, aunque el de la fila sea otro', () => {
        const out = resolverTurnoCopiado({
            fuente: mPuesto2,
            puestoDestino: 'Puesto 1',
            puestoDefecto: '',
            nombreDestino: 'Regalo, Juan',
            mesLabel: 'octubre',
            puestos,
        });
        assert.equal(out?.positionName, 'Puesto 2');
        assert.equal(out?.startTime, '06:00');
        assert.deepEqual(out?.avisos, []);
    });
});

describe('ventana externa', () => {
    const personas = [
        { id: 'a', name: 'ALFA' },
        { id: 'b', name: 'BETA' },
        { id: 'c', name: 'GAMMA' },
        { id: 'ext', name: 'INVITADO' },
    ];

    it('respeta el orden del cronograma y separa a quien no tiene turno', () => {
        const { conTurno, sinTurno } = armarFilasVentana(['c', 'a', 'b'], personas, (id) => id !== 'b');
        assert.deepEqual(conTurno.map((p) => p.id), ['c', 'a']);
        assert.deepEqual(sinTurno.map((p) => p.id), ['b']);
    });

    it('alinear por semana deja el lunes primero', () => {
        const jueves = new Date(2026, 9, 1);
        const mes = columnasCrono([jueves, new Date(2026, 9, 2)], 'mes');
        assert.equal(mes[0].date?.getDate(), 1);
        const semana = columnasCrono([jueves], 'semana');
        assert.equal(semana[0].date, null);
        assert.equal(semana.filter((c) => !c.date).length >= 3, true);
        assert.equal(semana.find((c) => c.date)?.date?.getDay(), 4);
        const sep1 = new Date(2026, 8, 1);
        const contraOctubre = columnasCrono([sep1, new Date(2026, 8, 2)], 'semana', jueves.getDay());
        const lead = (sep1.getDay() - jueves.getDay() + 7) % 7;
        assert.ok(lead > 0);
        assert.equal(contraOctubre.slice(0, lead).every((c) => c.date == null), true);
        assert.equal(contraOctubre[lead].date?.getDate(), 1);
    });

    it('el portapapeles guarda puesto y horario, y el nombre solo si se copió la columna', () => {
        const celda = { code: 'M', positionName: 'Puesto 2', startTime: '06:00', endTime: '14:00', hours: 8, name: 'Mañana' };
        const conNombre = armarPortapapeles({ filas: [{ nombre: 'REGALO', celdas: [celda] }], incluyeNombres: true });
        assert.equal(conNombre.tsv, 'REGALO\tM');
        assert.deepEqual(conNombre.nombres, ['REGALO']);
        assert.equal(conNombre.celdas[0][0]?.positionName, 'Puesto 2');
        assert.equal(conNombre.celdas[0][0]?.startTime, '06:00');
        const porPosicion = armarPortapapeles({ filas: [{ nombre: 'REGALO', celdas: [celda] }], incluyeNombres: false });
        assert.equal(porPosicion.tsv, 'M');
        assert.equal(porPosicion.nombres, undefined);
    });
});
