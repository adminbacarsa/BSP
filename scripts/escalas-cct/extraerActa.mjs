/**
 * Parser determinista del acta salarial con capa de texto (CCT 507/07, UPSRA-CAESI).
 * No llama a Gemini y no escribe Firestore. Un PDF escaneado, sin texto, no entra aca.
 */
import { createHash } from "node:crypto";

const CATEGORIAS = [
  ["Vigilador General", "VIGILADOR_GENERAL"],
  ["Vigilador Bombero", "VIGILADOR_BOMBERO"],
  ["Vigilador Principal", "VIGILADOR_PRINCIPAL"],
  ["Verificacion de Eventos", "VERIFICACION_EVENTOS"],
  ["Operador de Monitoreo", "OPERADOR_MONITOREO"],
  ["Instalador de Sistemas Electronicos", "INSTALADOR_SISTEMAS"],
  ["Controlador de Admision y Permanencia General", "CONTROLADOR_ADMISION"],
  ["Guia Tecnico", "GUIA_TECNICO"],
  ["Administrativo", "ADMINISTRATIVO"],
];

const MESES = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

const MES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";

function plano(texto) {
  return String(texto || "").replace(/\s+/g, " ").trim();
}

function sinAcento(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function juntarLetrasSueltas(s) {
  let prev = "";
  let cur = s;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(/\b(\p{L})\s+(\p{L})\b/gu, "$1$2");
  }
  return cur;
}

function preparar(texto) {
  return juntarLetrasSueltas(sinAcento(plano(texto)));
}

function pesos(raw) {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function convenioDe(texto) {
  if (/507\s*\/\s*07/.test(texto)) return "CCT_507_07";
  if (/422\s*\/\s*05/.test(texto)) return "CCT_422_05";
  return null;
}

function fechaDe(dia, mes, anio) {
  const mm = MESES[mes.toLowerCase()];
  if (!mm) return null;
  return `${anio}-${mm}-${String(dia).padStart(2, "0")}`;
}

function etiquetaFlexible(label) {
  return label.split("").map((ch) => {
    if (ch === " ") return "\\s+";
    return `${ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`;
  }).join("");
}

function basicosDelTramo(trozo) {
  const categorias = [];
  for (const [label, codigo] of CATEGORIAS) {
    const re = new RegExp(`${etiquetaFlexible(label)}\\s*:\\s*\\$\\s*([\\d.]+)`, "i");
    const m = trozo.match(re);
    const basicoMensual = m ? pesos(m[1]) : null;
    if (basicoMensual) categorias.push({ codigo, label, basicoMensual });
  }
  return categorias;
}

function montosPorMes(trozo) {
  const out = {};
  const re = new RegExp(`(${MES})\\s+de\\s+(\\d{4})\\s*:\\s*\\$\\s*([\\d.]+)`, "gi");
  let m;
  while ((m = re.exec(trozo))) {
    const ymd = fechaDe(1, m[1], m[2]);
    if (ymd) out[ymd.slice(0, 7)] = pesos(m[3]);
  }
  return out;
}

function sliceEntre(texto, desde, hasta) {
  const base = texto.toLowerCase();
  const i = base.indexOf(desde.toLowerCase());
  if (i < 0) return "";
  const resto = texto.slice(i);
  const j = hasta ? resto.toLowerCase().indexOf(hasta.toLowerCase(), desde.length) : -1;
  return j < 0 ? resto : resto.slice(0, j);
}

export function extraerActaSalarial(texto, meta = {}) {
  const crudo = String(texto || "");
  const cuerpo = preparar(crudo);
  if (cuerpo.length < 80) return { ok: false, codigo: "SIN_CAPA_DE_TEXTO" };
  const convenio = convenioDe(cuerpo);
  if (!convenio) return { ok: false, codigo: "CONVENIO_NO_RECONOCIDO" };

  const vig = cuerpo.match(new RegExp(
    `entre el 1\\u00b0?\\s*de\\s+(${MES})\\s+de\\s+(\\d{4})\\s+y el 31\\s+de\\s+(${MES})\\s+de\\s+(\\d{4})`,
    "i",
  ));
  if (!vig) return { ok: false, codigo: "SIN_VIGENCIA" };

  const bloqueBasicos = sliceEntre(cuerpo, "SALARIO BASICO DE CONVENIO", "suma no remunerativa");
  const partes = bloqueBasicos.split(/SALARIO BASICO DE CONVENIO/i);
  const tramos = [];
  for (const parte of partes) {
    const mes = parte.match(new RegExp(`durante el mes de\\s+(${MES})\\s+de\\s+(\\d{4})`, "i"));
    if (!mes) continue;
    const categorias = basicosDelTramo(parte);
    if (!categorias.length) continue;
    tramos.push({ vigenciaDesde: fechaDe(1, mes[1], mes[2]), categorias });
  }
  if (!tramos.length) return { ok: false, codigo: "SIN_BASICOS" };

  const noRem = montosPorMes(sliceEntre(cuerpo, "suma no remunerativa mensual", "clausula"));
  const viatico = montosPorMes(sliceEntre(cuerpo, "viatico", "clausula"));
  const presentismo = basicosDelTramo(sliceEntre(cuerpo, "adicional por presentismo", "viatico")).map((c) => ({
    codigo: c.codigo,
    label: c.label,
    montoMensual: c.basicoMensual,
  }));

  for (const tramo of tramos) {
    const clave = tramo.vigenciaDesde.slice(0, 7);
    tramo.noRemunerativoMensual = noRem[clave] ?? null;
    tramo.viaticoPorDia = viatico[clave] ?? null;
  }

  const incorpora = cuerpo.match(new RegExp(
    `incorporara a los salarios basicos de convenio a partir del 1\\u00b0?\\s*de\\s+(${MES})\\s+de\\s+(\\d{4})`,
    "i",
  ));
  const doc = cuerpo.match(/RE-\d{4}-\d+-APN-[A-Z0-9#]+/);

  return {
    ok: true,
    cct: convenio,
    distintoDe422: convenio !== "CCT_422_05",
    vigenciaDesde: fechaDe(1, vig[1], vig[2]),
    vigenciaHasta: fechaDe(31, vig[3], vig[4]),
    partes: ["UPSRA", "CAESI"],
    documento: doc ? doc[0] : null,
    tramos,
    presentismo,
    noRemunerativoSeIncorporaAlBasicoDesde: incorpora ? fechaDe(1, incorpora[1], incorpora[2]) : null,
    documentoHash: createHash("sha256").update(crudo).digest("hex"),
    fuenteUrl: meta.fuenteUrl || null,
  };
}
