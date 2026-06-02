/**
 * Compara liquidación payrollApi vs export JSON de Reportes.
 *
 *   node scripts/compare-payroll-api-reportes.js \
 *     --apiJson scripts/_tmp-liquidacion-api-2026-06.json \
 *     --reportJson C:\Users\Mauro\Downloads\liquidacion_2026-05-26_2026-06-25.json
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (!k.startsWith('--')) continue;
        const key = k.slice(2);
        out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
    return out;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
}

function normalizeReportItem(item) {
    const emp = item.employee || {};
    return {
        legajo: String(emp.fileNumber || emp.legajo || '').trim(),
        id: emp.id || '',
        name: emp.fullName || item.name || '',
        hsTeoricas: item.acumulado?.hsTeoricas ?? item.horasTeoricas ?? item.total ?? 0,
        hsReales: item.acumulado?.hsReales ?? item.horasReales ?? 0,
        diurnas: item.acumulado?.diurnas ?? item.diurnas ?? 0,
        nocturnas: item.acumulado?.nocturnas ?? item.nocturnas ?? 0,
        al100FT: item.acumulado?.al100FT ?? item.extra100 ?? 0,
        plusFeriado: item.acumulado?.plusFeriado ?? item.plusFeriado ?? 0,
        turnos: item.turnosCount ?? item.shifts ?? 0,
        turnosConFichada: item.turnosConFichada ?? item.turnosConDatosReales ?? 0,
    };
}

function indexByKey(items) {
    const map = new Map();
    for (const raw of items || []) {
        const n = normalizeReportItem(raw);
        const key = n.legajo || n.id;
        if (!key) continue;
        map.set(key, n);
    }
    return map;
}

function compareMaps(reportMap, apiMap) {
    const reportKeys = new Set([...reportMap.keys()].filter(Boolean));
    const apiKeys = new Set([...apiMap.keys()].filter(Boolean));
    const onlyReport = [...reportKeys].filter(k => !apiKeys.has(k));
    const onlyApi = [...apiKeys].filter(k => !reportKeys.has(k));
    const common = [...reportKeys].filter(k => apiKeys.has(k));

    const diffs = [];
    for (const key of common) {
        const rep = reportMap.get(key);
        const api = apiMap.get(key);
        const fields = [
            ['hsTeoricas', rep.hsTeoricas, api.hsTeoricas],
            ['hsReales', rep.hsReales, api.hsReales],
            ['diurnas', rep.diurnas, api.diurnas],
            ['nocturnas', rep.nocturnas, api.nocturnas],
            ['al100FT', rep.al100FT, api.al100FT],
            ['plusFeriado', rep.plusFeriado, api.plusFeriado],
            ['turnos', rep.turnos, api.turnos],
            ['turnosConFichada', rep.turnosConFichada, api.turnosConFichada],
        ];
        const rowDiffs = fields.filter(([, a, b]) => round2(a) !== round2(b));
        if (rowDiffs.length) {
            diffs.push({
                key,
                name: rep.name || api.name,
                diffs: rowDiffs.map(([f, a, b]) => ({ field: f, reportes: round2(a), api: round2(b) })),
            });
        }
    }

    return { onlyReport, onlyApi, common, diffs };
}

function printComparison(meta, reportMap, apiMap) {
    const { onlyReport, onlyApi, common, diffs } = compareMaps(reportMap, apiMap);

    console.log('\n=== COMPARACIÓN payrollApi vs Reportes ===');
    if (meta.cycleId) console.log('Ciclo API:', meta.cycleId, meta.range ? `(${meta.range})` : '');
    if (meta.reportFilter) console.log('Filtro Reportes:', meta.reportFilter);
    if (meta.reportRange) console.log('Rango Reportes:', meta.reportRange);
    console.log('');
    console.log('Empleados Reportes:', reportMap.size);
    console.log('Empleados API:     ', apiMap.size);
    console.log('');
    console.log('Solo en Reportes:', onlyReport.length);
    if (onlyReport.length) {
        onlyReport.slice(0, 15).forEach(k => {
            const r = reportMap.get(k);
            console.log(`  ${k} ${r?.name || ''} (teor=${r?.hsTeoricas}, turnos=${r?.turnos})`);
        });
        if (onlyReport.length > 15) console.log(`  ... +${onlyReport.length - 15} más`);
    }
    console.log('Solo en API:     ', onlyApi.length);
    if (onlyApi.length) {
        onlyApi.slice(0, 15).forEach(k => {
            const a = apiMap.get(k);
            console.log(`  ${k} ${a?.name || ''} (teor=${a?.hsTeoricas}, turnos=${a?.turnos})`);
        });
    }
    console.log('En común:        ', common.length);
    console.log('Con diferencias: ', diffs.length);

    if (diffs.length) {
        console.log('\n--- Diferencias en común (hasta 20) ---');
        diffs.slice(0, 20).forEach(d => {
            console.log(`\n[${d.key}] ${d.name}`);
            d.diffs.forEach(x => console.log(`  ${x.field.padEnd(18)} Reportes=${x.reportes}  API=${x.api}`));
        });
    } else if (common.length && !onlyReport.length && !onlyApi.length) {
        console.log('\n✓ Mismos empleados y mismos números en todos los campos.');
    }

    const outPath = path.join(__dirname, `_tmp-comparacion-${meta.cycleId || 'reportes'}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        meta,
        reportCount: reportMap.size,
        apiCount: apiMap.size,
        onlyReport: onlyReport.map(k => ({ key: k, ...reportMap.get(k) })),
        onlyApi: onlyApi.map(k => ({ key: k, ...apiMap.get(k) })),
        diffs,
    }, null, 2));
    console.log('\nDetalle guardado en:', outPath);
}

function compareJsonFiles(apiJsonPath, reportJsonPath) {
    if (!fs.existsSync(apiJsonPath)) throw new Error(`No existe API JSON: ${apiJsonPath}`);
    if (!fs.existsSync(reportJsonPath)) throw new Error(`No existe Reportes JSON: ${reportJsonPath}`);

    const api = readJson(apiJsonPath);
    const report = readJson(reportJsonPath);

    printComparison({
        cycleId: api.cycleId,
        range: api.cycleStart && api.cycleEnd ? `${api.cycleStart} → ${api.cycleEnd}` : null,
        reportFilter: report.publishFilter || 'unknown',
        reportRange: report.dateRange ? `${report.dateRange.start} → ${report.dateRange.end}` : null,
    }, indexByKey(report.items), indexByKey(api.items));
}

async function main() {
    const args = parseArgs(process.argv);
    const apiJsonPath = args.apiJson || path.join(__dirname, '_tmp-liquidacion-api-2026-06.json');

    if (!args.reportJson) {
        console.log('Falta --reportJson');
        process.exit(1);
    }

    compareJsonFiles(apiJsonPath, args.reportJson);
}

main().catch(e => {
    console.error('Error:', e.message || e);
    process.exit(1);
});
