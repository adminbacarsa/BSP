"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferirCoberturaFeriados = inferirCoberturaFeriados;
exports.feriadosConCobertura = feriadosConCobertura;
exports.fechasFeriadosConCobertura = fechasFeriadosConCobertura;
exports.esFeriadoConCobertura = esFeriadoConCobertura;
function calcularPascua(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}
function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
}
function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function trasladarLunes(date) {
    const dow = date.getDay();
    if (dow === 1)
        return date;
    if (dow === 2 || dow === 3)
        return addDays(date, 1 - dow);
    return addDays(date, 8 - dow);
}
function obtenerFeriadosAnio(year) {
    const pascua = calcularPascua(year);
    const mapa = new Map();
    function add(date, nombre, provincial = false) {
        mapa.set(toDateStr(date), { nombre, esNacional: !provincial, esProvincial: provincial });
    }
    add(new Date(year, 0, 1), 'Año Nuevo');
    add(new Date(year, 2, 24), 'Día Nacional de la Memoria por la Verdad y la Justicia');
    add(new Date(year, 3, 2), 'Día del Veterano y de los Caídos en la Guerra de Malvinas');
    add(new Date(year, 4, 1), 'Día Internacional de las/los Trabajadoras/es');
    add(new Date(year, 4, 25), 'Día de la Revolución de Mayo');
    add(new Date(year, 6, 9), 'Día de la Independencia');
    add(new Date(year, 11, 8), 'Inmaculada Concepción de María');
    add(new Date(year, 11, 25), 'Navidad');
    const belgrano = new Date(year, 5, 20);
    add(belgrano.getDay() === 1 ? belgrano : trasladarLunes(belgrano), 'Paso a la Inmortalidad del Gral. Manuel Belgrano');
    const guemes = new Date(year, 5, 17);
    add(guemes.getDay() === 1 ? guemes : trasladarLunes(guemes), 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes');
    const sanMartin = new Date(year, 7, 17);
    add(sanMartin.getDay() === 1 ? sanMartin : trasladarLunes(sanMartin), 'Paso a la Inmortalidad del Gral. José de San Martín');
    const diversidad = new Date(year, 9, 12);
    add(diversidad.getDay() === 1 ? diversidad : trasladarLunes(diversidad), 'Día del Respeto a la Diversidad Cultural');
    const soberania = new Date(year, 10, 20);
    add(soberania.getDay() === 1 ? soberania : trasladarLunes(soberania), 'Día de la Soberanía Nacional');
    add(addDays(pascua, -48), 'Lunes de Carnaval');
    add(addDays(pascua, -47), 'Martes de Carnaval');
    add(addDays(pascua, -2), 'Viernes Santo');
    return mapa;
}
function inferirCoberturaFeriados(sla, year) {
    const todasDefinidas = sla.positions.every(p => p.operaFeriados !== undefined);
    const operaFeriados = todasDefinidas
        ? sla.positions.some(p => p.operaFeriados === true)
        : true;
    const excludedGlobal = new Set(sla.excludedDates ?? []);
    const feriados = obtenerFeriadosAnio(year);
    const resultado = [];
    for (const [fecha, info] of feriados.entries()) {
        const excluido = excludedGlobal.has(fecha);
        const requiereCobertura = operaFeriados && !excluido;
        resultado.push({
            fecha,
            nombreFeriado: info.nombre,
            requiereCobertura,
            tipoCodigo: requiereCobertura ? 'FF' : 'normal',
            esFeriadoNacional: info.esNacional,
            esFeriadoProvincial: info.esProvincial,
        });
    }
    return resultado.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function feriadosConCobertura(feriados) {
    return feriados.filter(f => f.requiereCobertura);
}
function fechasFeriadosConCobertura(feriados) {
    return feriadosConCobertura(feriados).map(f => f.fecha);
}
function esFeriadoConCobertura(feriados, fecha) {
    return feriados.some(f => f.fecha === fecha && f.requiereCobertura);
}
//# sourceMappingURL=s5-cobertura-feriados.js.map