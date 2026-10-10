import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coloresParaTsv, parsearHtmlExcel, tonoDeColor } from './pegadoExcelColor';
import {
    agruparAvisos,
    avisosSinVer,
    claveAvisosVistos,
    diasConE,
    idAviso,
    idGrupoAviso,
    parsearTsv,
    prepararPegadoExcel,
    textoCargarEvento,
    textoDiaE,
    type AvisoRapido,
} from './modoRapido';

const CONOCIDOS = new Set(['M', 'T', 'N', 'F', 'RET', 'E', 'V', 'A', 'D12', 'N12']);
const guardias = [
    { fila: 0, nombre: 'LOPEZ, Daniel Alberto', legajo: '100' },
    { fila: 1, nombre: 'BORDINO, Carlos', legajo: '101' },
    { fila: 2, nombre: 'VIDELA, Juan', legajo: '102' },
    { fila: 3, nombre: 'ARAYA, Pedro', legajo: '103' },
    { fila: 4, nombre: 'KASIANCHUK, Ivan', legajo: '104' },
];

/** Como lo pone Excel en el portapapeles: estilos por clase y celdas con class/style. */
function htmlExcel(filas: Array<Array<{ t: string; cl?: string }>>): string {
    const css = `<style><!--
.xl65 {mso-style-parent:style0; background:yellow; mso-pattern:black none;}
.xl66 {mso-style-parent:style0; background:#FF0000; mso-pattern:black none;}
.xl67 {mso-style-parent:style0; background:#FFC000; mso-pattern:black none;}
.xl68 {mso-style-parent:style0; color:red;}
.xl69 {mso-style-parent:style0; background:#DDEBF7;}
--></style>`;
    const trs = filas.map((f) => `<tr height=20>${f.map((c) => `<td${c.cl ? ` class=${c.cl}` : ''}>${c.t || '&nbsp;'}</td>`).join('')}</tr>`).join('\n');
    return `<html><head>${css}</head><body><table border=0><!--StartFragment-->\n${trs}\n<!--EndFragment--></table></body></html>`;
}

describe('pegado de Excel · color de la celda', () => {
    it('clasifica amarillo, naranja y rojo de las planillas', () => {
        assert.equal(tonoDeColor('yellow'), 'AMARILLO');
        assert.equal(tonoDeColor('#FFFF00'), 'AMARILLO');
        assert.equal(tonoDeColor('#FFFF99'), 'AMARILLO');
        assert.equal(tonoDeColor('#FFC000'), 'NARANJA');
        assert.equal(tonoDeColor('#ED7D31'), 'NARANJA');
        assert.equal(tonoDeColor('red'), 'ROJO');
        assert.equal(tonoDeColor('rgb(255, 0, 0)'), 'ROJO');
        assert.equal(tonoDeColor('#C00000'), 'ROJO');
        assert.equal(tonoDeColor('white'), null);
        assert.equal(tonoDeColor('#DDEBF7'), 'OTRO');
        assert.equal(tonoDeColor('none'), null);
    });

    it('lee clases, style, bgcolor y colspan', () => {
        const html = `<style>.xl70{background:yellow}</style><table>
<tr><td class=xl70>E</td><td style="background-color:#ff0000">M</td><td colspan=2 bgcolor="#FFC000">CM</td></tr>
</table>`;
        const t = parsearHtmlExcel(html);
        assert.equal(t.length, 1);
        assert.deepEqual(t[0].map((c) => c.texto), ['E', 'M', 'CM', '']);
        assert.deepEqual(t[0].map((c) => c.color.fondo), ['AMARILLO', 'ROJO', 'NARANJA', 'NARANJA']);
    });

    it('alinea los colores con el TSV y descarta si no coincide', () => {
        const tsv = 'LOPEZ DANIEL ALBERTO\tE\tM\nBORDINO CARLOS\tE\tN';
        const html = htmlExcel([
            [{ t: 'LOPEZ DANIEL ALBERTO' }, { t: 'E', cl: 'xl65' }, { t: 'M', cl: 'xl66' }],
            [{ t: 'BORDINO CARLOS' }, { t: 'E' }, { t: 'N', cl: 'xl68' }],
        ]);
        const cols = coloresParaTsv(parsearTsv(tsv), html)!;
        assert.ok(cols);
        assert.equal(cols[0]![1]?.fondo, 'AMARILLO');
        assert.equal(cols[0]![2]?.fondo, 'ROJO');
        assert.equal(cols[1]![1]?.fondo, null);
        assert.equal(cols[1]![2]?.letra, 'ROJO');
        assert.equal(coloresParaTsv(parsearTsv('A\tB\nC\tD\nE\tF'), html), null);
        assert.equal(coloresParaTsv(parsearTsv('A\tB'), '<table><tr><td>A</td><td>B</td></tr></table>'), null);
    });

    it('con color: E amarilla es evento, E sin color enfermedad, CM naranja E, M y N rojas a 12 h', () => {
        const tsv = [
            'LOPEZ DANIEL ALBERTO\tM\tE\tM',
            'BORDINO CARLOS\tT\tE\tN',
            'VIDELA JUAN\tN\tCM\tART',
            'ARAYA PEDRO\tF\tE\tF',
        ].join('\n');
        const html = htmlExcel([
            [{ t: 'LOPEZ DANIEL ALBERTO' }, { t: 'M', cl: 'xl66' }, { t: 'E', cl: 'xl65' }, { t: 'M' }],
            [{ t: 'BORDINO CARLOS' }, { t: 'T' }, { t: 'E', cl: 'xl65' }, { t: 'N', cl: 'xl66' }],
            [{ t: 'VIDELA JUAN' }, { t: 'N' }, { t: 'CM', cl: 'xl67' }, { t: 'ART', cl: 'xl65' }],
            [{ t: 'ARAYA PEDRO' }, { t: 'F' }, { t: 'E', cl: 'xl69' }, { t: 'F' }],
        ]);
        const matriz = parsearTsv(tsv);
        const p = prepararPegadoExcel(matriz, { guardias, cursor: { r: 0, c: 16 }, cols: 31, conocidos: CONOCIDOS, colores: coloresParaTsv(matriz, html) });
        assert.equal(p.conColor, true);
        const lopez = p.filas.find((f) => f.nombre.startsWith('LOPEZ'))!;
        assert.deepEqual(lopez.celdas, [{ col: 16, code: 'D12' }, { col: 17, code: 'E', evento: 'SEGURO' }, { col: 18, code: 'M' }]);
        const bordino = p.filas.find((f) => f.nombre.startsWith('BORDINO'))!;
        assert.deepEqual(bordino.celdas.map((c) => c.code), ['T', 'E', 'N12']);
        const videla = p.filas.find((f) => f.nombre.startsWith('VIDELA'))!;
        assert.deepEqual(videla.celdas, [{ col: 16, code: 'N' }, { col: 17, code: 'E' }, { col: 18, code: 'A' }]);
        const araya = p.filas.find((f) => f.nombre.startsWith('ARAYA'))!;
        assert.deepEqual(araya.celdas[1], { col: 17, code: 'E' });
        assert.deepEqual(p.diasE, [{ col: 17, cantidad: 2, seguras: 2, dudosas: 0, porDefecto: 'EVENTO' }]);
    });

    it('sin color: la E es dudosa; evento por defecto si 3 o más guardias la tienen ese día', () => {
        const tsv = [
            'LOPEZ DANIEL ALBERTO\tM\tE\tE',
            'BORDINO CARLOS\tM\tE\tT',
            'VIDELA JUAN\tT\tE\tT',
            'ARAYA PEDRO\tT\tE\tN',
            'KASIANCHUK IVAN\tN\tN\tN',
        ].join('\n');
        const p = prepararPegadoExcel(parsearTsv(tsv), { guardias, cursor: { r: 0, c: 15 }, cols: 31, conocidos: CONOCIDOS });
        assert.equal(p.conColor, false);
        assert.ok(p.filas[0].celdas.some((c) => c.col === 16 && c.evento === 'DUDA'));
        assert.deepEqual(p.diasE, [
            { col: 16, cantidad: 4, seguras: 0, dudosas: 4, porDefecto: 'EVENTO' },
            { col: 17, cantidad: 1, seguras: 0, dudosas: 1, porDefecto: 'E' },
        ]);
        assert.equal(textoDiaE(p.diasE[0], '2026-10-17'), '4 celdas “E” del 17/10: ¿Evento o Enfermedad?');
        assert.equal(textoDiaE({ col: 0, cantidad: 4, seguras: 4, dudosas: 0, porDefecto: 'EVENTO' }, '2026-10-17'), '4 celdas “E” amarillas del 17/10: evento');
        assert.equal(textoCargarEvento(['2026-10-17', '2026-10-17']), 'Cargá el evento del 17/10 en Eventos para asignarlos');
    });

    it('«EV» o «EVENTO» escrito en la planilla es evento aunque no haya color', () => {
        const p = prepararPegadoExcel(parsearTsv('LOPEZ DANIEL ALBERTO\tEV\tEVENTO\tM'), { guardias, cursor: { r: 0, c: 0 }, cols: 31, conocidos: CONOCIDOS });
        assert.deepEqual(p.filas[0].celdas.slice(0, 2), [{ col: 0, code: 'E', evento: 'SEGURO' }, { col: 1, code: 'E', evento: 'SEGURO' }]);
        assert.equal(diasConE(p.filas).every((d) => d.porDefecto === 'EVENTO'), true);
    });
});

describe('modo rápido · avisos vistos', () => {
    const base = (dateStr: string, restHours = 9): AvisoRapido => ({ tipo: 'DESCANSO', empId: 'v', nombre: 'VIDELA, Juan', dateStr, restHours, texto: 't' });

    it('la identidad es guardia + día + tipo + horas', () => {
        assert.equal(idAviso(base('2026-10-12')), 'DESCANSO|v|2026-10-12|9');
        assert.notEqual(idAviso(base('2026-10-12')), idAviso(base('2026-10-12', 10)));
        assert.notEqual(idAviso(base('2026-10-12')), idAviso(base('2026-10-13')));
        assert.notEqual(idAviso(base('2026-10-12')), idAviso({ ...base('2026-10-12'), empId: 'w' }));
        const tope: AvisoRapido = { tipo: 'TOPE', empId: 'v', nombre: 'VIDELA', dateStr: '2026-10-28', monthHours: 204, cap: 200, texto: 't' };
        assert.notEqual(idAviso(tope), idAviso({ ...tope, monthHours: 212 }));
    });

    it('el grupo suma los días ordenados', () => {
        const [g] = agruparAvisos([base('2026-10-15'), base('2026-10-12')]);
        assert.equal(idGrupoAviso(g), 'DESCANSO|v|2026-10-12,2026-10-15|9');
    });

    it('visto saca el aviso; si cambia el día o las horas vuelve a aparecer', () => {
        const vistos = new Set([idAviso(base('2026-10-12')), idAviso(base('2026-10-15'))]);
        assert.equal(avisosSinVer([base('2026-10-12'), base('2026-10-15')], vistos).length, 0);
        const despues = avisosSinVer([base('2026-10-12'), base('2026-10-16'), base('2026-10-15', 8)], vistos);
        assert.deepEqual(despues.map((a) => `${a.dateStr}:${a.restHours}`), ['2026-10-16:9', '2026-10-15:8']);
    });

    it('la clave del navegador es por objetivo y mes', () => {
        assert.equal(claveAvisosVistos('obj1', 2026, 10), 'cosp-planif-avisos-vistos:obj1:2026-10');
        assert.notEqual(claveAvisosVistos('obj1', 2026, 10), claveAvisosVistos('obj1', 2026, 11));
    });
});
