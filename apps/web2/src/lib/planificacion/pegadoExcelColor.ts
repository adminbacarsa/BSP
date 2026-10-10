/**
 * Color de las celdas al pegar desde Excel. El portapapeles trae `text/html` junto al TSV;
 * de ahí sale el fondo (y la letra) de cada celda. Si el HTML no se puede alinear con el TSV
 * se descarta entero y el pegado sigue solo con el texto.
 */

export type TonoCelda = 'AMARILLO' | 'NARANJA' | 'ROJO' | 'OTRO';

export type ColorCelda = { fondo: TonoCelda | null; letra: TonoCelda | null };

const NOMBRES: Record<string, string> = {
    yellow: '#ffff00',
    red: '#ff0000',
    orange: '#ffa500',
    gold: '#ffd700',
    white: '#ffffff',
    black: '#000000',
    windowtext: '#000000',
    window: '#ffffff',
};

function rgbDe(valor: string): [number, number, number] | null {
    const v = String(valor || '').trim().toLowerCase().replace(/!important/g, '').trim();
    if (!v || v === 'none' || v === 'transparent' || v === 'auto' || v === 'inherit') return null;
    const nombre = NOMBRES[v];
    const hex = nombre || v;
    let m = hex.match(/^#([0-9a-f]{6})$/);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = hex.match(/^#([0-9a-f]{3})$/);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
}

/** Amarillo, naranja o rojo (los tonos de las planillas); el resto es OTRO; blanco o sin color, null. */
export function tonoDeColor(valor: string): TonoCelda | null {
    const rgb = rgbDe(valor);
    if (!rgb) return null;
    const [r, g, b] = rgb.map((x) => x / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (max >= 0.95 && d < 0.08) return null;
    const s = max === 0 ? 0 : d / max;
    if (s < 0.3 || max < 0.45) return 'OTRO';
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    if (h < 15 || h >= 340) return 'ROJO';
    if (h < 52) return 'NARANJA';
    if (h < 72) return 'AMARILLO';
    return 'OTRO';
}

type Estilo = { fondo?: string; letra?: string };

function leerEstilo(css: string): Estilo {
    const out: Estilo = {};
    for (const parte of String(css || '').split(';')) {
        const i = parte.indexOf(':');
        if (i < 0) continue;
        const prop = parte.slice(0, i).trim().toLowerCase();
        const val = parte.slice(i + 1).trim();
        if (prop === 'background' || prop === 'background-color') {
            const tok = val.split(/\s+/).find((t) => rgbDe(t)) || val;
            out.fondo = tok;
        } else if (prop === 'color') out.letra = val;
    }
    return out;
}

function decodificar(s: string): string {
    return s
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();
}

function atributo(tag: string, nombre: string): string {
    const m = tag.match(new RegExp(`\\b${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

export type CeldaHtml = { texto: string; color: ColorCelda };

/** Filas y celdas de la tabla del HTML de Excel / Sheets, con colspan y rowspan expandidos. */
export function parsearHtmlExcel(html: string): CeldaHtml[][] {
    if (!html || !/<td/i.test(html)) return [];
    const clases = new Map<string, Estilo>();
    for (const bloque of html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []) {
        const re = /\.([\w-]+)\s*\{([^}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(bloque))) clases.set(m[1].toLowerCase(), { ...clases.get(m[1].toLowerCase()), ...leerEstilo(m[2]) });
    }
    const filas: CeldaHtml[][] = [];
    const pendientes: Array<Map<number, CeldaHtml>> = [];
    const trs = html.match(/<tr\b[\s\S]*?(?=<tr\b|<\/table>|$)/gi) || [];
    for (let fi = 0; fi < trs.length; fi++) {
        const tr = trs[fi];
        const fila: CeldaHtml[] = [];
        const ocupadas = pendientes[fi] || new Map<number, CeldaHtml>();
        const re = /<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi;
        let m: RegExpExecArray | null;
        let col = 0;
        while ((m = re.exec(tr))) {
            while (ocupadas.has(col)) { fila.push(ocupadas.get(col)!); col++; }
            const tag = m[1];
            const cuerpo = m[2].replace(/<\/t[dh]>[\s\S]*$/i, '');
            let estilo: Estilo = {};
            for (const cl of atributo(tag, 'class').split(/\s+/).filter(Boolean)) estilo = { ...estilo, ...clases.get(cl.toLowerCase()) };
            estilo = { ...estilo, ...leerEstilo(atributo(tag, 'style')) };
            const bg = atributo(tag, 'bgcolor');
            if (bg && !estilo.fondo) estilo.fondo = bg;
            const font = cuerpo.match(/<font\b[^>]*\bcolor\s*=\s*["']?([^"'\s>]+)/i);
            if (font && !estilo.letra) estilo.letra = font[1];
            const spanStyle = cuerpo.match(/<span\b[^>]*style\s*=\s*["']([^"']*)["']/i);
            if (spanStyle) {
                const e2 = leerEstilo(spanStyle[1]);
                if (e2.letra && !estilo.letra) estilo.letra = e2.letra;
                if (e2.fondo && !estilo.fondo) estilo.fondo = e2.fondo;
            }
            const celda: CeldaHtml = {
                texto: decodificar(cuerpo).toUpperCase(),
                color: { fondo: estilo.fondo ? tonoDeColor(estilo.fondo) : null, letra: estilo.letra ? tonoDeColor(estilo.letra) : null },
            };
            const colspan = Math.max(1, Math.min(60, Number(atributo(tag, 'colspan')) || 1));
            const rowspan = Math.max(1, Math.min(60, Number(atributo(tag, 'rowspan')) || 1));
            for (let k = 0; k < colspan; k++) {
                const cel = k === 0 ? celda : { texto: '', color: celda.color };
                fila.push(cel);
                for (let rr = 1; rr < rowspan; rr++) {
                    const mapa = pendientes[fi + rr] || new Map<number, CeldaHtml>();
                    mapa.set(col, { texto: '', color: celda.color });
                    pendientes[fi + rr] = mapa;
                }
                col++;
            }
        }
        while (ocupadas.has(col)) { fila.push(ocupadas.get(col)!); col++; }
        filas.push(fila);
    }
    return filas;
}

/**
 * Colores alineados a la matriz del TSV. Si la cantidad de filas no coincide se descarta todo;
 * una fila que no coincide en celdas queda sin color. Si ninguna celda trae fondo, no hay color.
 */
export function coloresParaTsv(matriz: string[][], html: string): Array<Array<ColorCelda | null> | null> | null {
    const tabla = parsearHtmlExcel(html);
    if (!tabla.length) return null;
    const filasHtml = tabla.slice();
    while (filasHtml.length > matriz.length && !filasHtml[filasHtml.length - 1].some((c) => c.texto)) filasHtml.pop();
    if (filasHtml.length !== matriz.length) return null;
    const plano = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f"]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    let alguno = false;
    const out = matriz.map((fila, i) => {
        const h = filasHtml[i];
        if (h.length < fila.length) return null;
        let llenas = 0;
        let distintas = 0;
        fila.forEach((v, c) => {
            const vv = plano(v);
            const t = plano(h[c]?.texto || '');
            if (!vv && !t) return;
            llenas++;
            if (vv !== t) distintas++;
        });
        if (distintas > Math.max(1, Math.floor(llenas * 0.1))) return null;
        return fila.map((_, c) => {
            const col = h[c]?.color || null;
            if (col?.fondo) alguno = true;
            return col;
        });
    });
    return alguno ? out : null;
}
