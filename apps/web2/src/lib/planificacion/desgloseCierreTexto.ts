/** Textos del modal «Desglose de horas»: cierre contra vendidas y la línea «Fuera». */

export function textoCierreContraVendidas(input: {
  mesPublicado: boolean;
  horasCierre: number;
  vendidas: number;
}): string {
  if (!(input.vendidas > 0)) return '';
  const delta = Math.round(input.horasCierre - input.vendidas);
  if (!input.mesPublicado) {
    if (delta === 0) return 'Cierre OK (borrador, sin publicar)';
    if (delta < 0) return `Faltan ${-delta}h (borrador, sin publicar)`;
    return `Sobran ${delta}h (borrador, sin publicar)`;
  }
  if (delta === 0) return 'Cierre OK';
  if (delta < 0) return `Faltan ${-delta}h facturables`;
  return `+${delta}h sobre vendidas`;
}

export function textoFueraDelCierre(input: {
  mesPublicado: boolean;
  horasPublicadas: number;
  baseSla: number;
  ftHours: number;
  uncodedHours: number;
}): string {
  if (!input.mesPublicado) {
    const cierre = Math.round(input.baseSla);
    return `Mes sin publicar. Cierre con borrador ${cierre}h. No hay malla publicada que el cierre descarte.`;
  }
  const resto = Math.round((input.horasPublicadas - input.baseSla - input.ftHours - input.uncodedHours) * 10) / 10;
  const partes = [`FT ${input.ftHours}h`];
  if (input.uncodedHours) partes.push(`sin código ${input.uncodedHours}h`);
  if (resto) partes.push(`${resto}h que el cierre descarta`);
  return `No es el plan. Fuera: ${partes.join(', ')} · ${input.baseSla} + eso = ${input.horasPublicadas}h`;
}
