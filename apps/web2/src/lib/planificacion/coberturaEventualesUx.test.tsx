import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BarraPreguntar,
  ConfirmarAsignacion,
  ModoEventualesSelector,
  NoDisponiblesLista,
  TarjetaEventual,
  type CandidatoTarjeta,
} from '@/components/eventuales/EventualesCandidatosUx';
import { ConsultasEnCursoPill, IndicadorConsultaCelda } from '@/components/planificacion/ConsultasEnCurso';
import {
  CoberturaBarra,
  CoberturaDias,
  CoberturaFranja,
  CoberturaPie,
  CoberturaTabs,
  ConsultaDiaBox,
  FilaCandidatoNomina,
  ModoCoberturaSwitch,
  NoDisponiblesNomina,
} from '@/components/planificacion/CoberturaModalV2';
import { CandidatosHueco } from '@/components/movil/PlanificacionMovilView';
import { buildBrandCSS, buildCompanyTheme, companyButtonColor } from '@/lib/companyTheme';
import {
  accionParaMotivo,
  cambiosManualesSobreConsulta,
  consultaAbiertaEnFecha,
  consultaDelDia,
  diaLoResuelveConsulta,
  estadoDiaCobertura,
  linkFichaEventual,
  novedadesDeConsultas,
  quitarBorradorQuePisaConsulta,
  textoAccionPrincipal,
  textoBarraAsignar,
  textoBarraSplit,
  textoBotonAsignar,
  textoCubrir,
  textoIndicadorConsulta,
  textoRangoDias,
  textoToastAcepto,
  textoTooltipConsulta,
  resumenConsultaDia,
  separarCandidatos,
  horasDelBloque,
  textoBarraPreguntar,
  textoBotonEnviar,
  textoConfirmarAsignacion,
  textoDosContratos,
  textoHorasBloque,
  textoTopeBloque,
} from '@/lib/planificacion/coberturaEventualesUx';

const JORNADA = { fecha: '2026-10-06', code: 'M', horaInicio: '10:45', horaFin: '12:00' };

const aballay: CandidatoTarjeta = {
  cuil: '20111111112', nombre: 'ABALLAY, Juan', telefono: '351-555', elegible: true, motivo: null, motivoCodigo: null,
  distanciaKm: 4.2, horasMes: { texto: '16/50 h este mes', aviso: false },
};
const bloqueados: CandidatoTarjeta[] = [
  { cuil: '20222222223', nombre: 'BRIZUELA, Ana', elegible: false, motivo: 'Sin contrato marco vigente.', motivoCodigo: 'SIN_MARCO', distanciaKm: null },
  { cuil: '20333333334', nombre: 'CASAS, Luis', elegible: false, motivo: 'Credencial vencida.', motivoCodigo: 'CREDENCIAL_VENCIDA', distanciaKm: 8 },
  { cuil: '20444444445', nombre: 'DIAZ, Pedro', elegible: false, motivo: 'Faltan horas de descanso.', motivoCodigo: 'DESCANSO_12H', distanciaKm: 2 },
];

test('elegibles arriba y bloqueados aparte; el tope sigue en su propia línea', () => {
  const r = separarCandidatos([
    ...bloqueados,
    aballay,
    { ...aballay, cuil: '20555555556', nombre: 'TOPE, X', elegible: false, motivoCodigo: 'TOPE_CERCA', motivo: 'Cerca del tope.' },
  ]);
  assert.deepEqual(r.elegibles.map((c) => c.nombre), ['ABALLAY, Juan']);
  assert.equal(r.noDisponibles.length, 3);
  assert.equal(r.ocultosTope.length, 1);
});

test('el motivo que se resuelve en la ficha trae su acción y link; descanso o superposición no', () => {
  assert.equal(accionParaMotivo('SIN_MARCO'), 'Cargar marco');
  assert.equal(accionParaMotivo('CREDENCIAL_VENCIDA'), 'Cargar vencimiento de credencial');
  assert.equal(accionParaMotivo('DESCANSO_12H'), null);
  assert.equal(accionParaMotivo('SUPERPOSICION'), null);
  assert.equal(linkFichaEventual('20222222223'), '/admin/rrhh/eventuales/?cuil=20222222223');
});

test('la barra de preguntar nombra el turno, sin «Lugares»; el bloque junta los días, las horas y los dos contratos', () => {
  assert.equal(textoBarraPreguntar(0, [JORNADA]), 'Marcá a quién preguntar');
  assert.equal(textoBarraPreguntar(3, [JORNADA]), 'Preguntar a 3 · el primero que acepte cubre 06/10 · M 10:45–12:00');
  const mismo = [
    { ...JORNADA, fecha: '2026-10-06', horaInicio: '07:00', horaFin: '15:00', horas: 8 },
    { ...JORNADA, fecha: '2026-10-15', horaInicio: '07:00', horaFin: '15:00', horas: 8 },
  ];
  assert.equal(textoBarraPreguntar(2, mismo), 'Preguntar a 2 · El primero que acepte cubre los 2 días marcados (06/10 → 15/10) · M 07:00–15:00');
  assert.equal(horasDelBloque(mismo), 16);
  assert.equal(textoHorasBloque(16), 'El bloque suma 16 h');
  const distintos = [
    { fecha: '2026-10-06', code: 'M', horaInicio: '07:00', horaFin: '15:00', horas: 8 },
    { fecha: '2026-10-07', code: 'T', horaInicio: '15:00', horaFin: '23:00', horas: 8 },
  ];
  assert.match(textoBarraPreguntar(1, distintos), /06\/10 · M 07:00–15:00 · 07\/10 · T 15:00–23:00/);
  const cruza = [
    { fecha: '2026-10-28', code: 'M', horaInicio: '07:00', horaFin: '15:00', horas: 8 },
    { fecha: '2026-11-03', code: 'M', horaInicio: '07:00', horaFin: '15:00', horas: 8 },
  ];
  assert.equal(textoDosContratos(cruza), 'Son dos contratos (octubre 2026 8 h y noviembre 2026 8 h).');
  assert.match(textoBarraPreguntar(1, cruza), /Son dos contratos \(octubre 2026 8 h y noviembre 2026 8 h\)/);
  assert.equal(textoTopeBloque({ usadas: 40, tope: 50 }, mismo), 'El bloque (16 h) no entra en el tope (40/50 h)');
  assert.equal(textoTopeBloque({ usadas: 10, tope: 50 }, mismo), null);
  assert.equal(textoTopeBloque({ usadas: 40, tope: 50 }, cruza), null);
  assert.equal(textoBotonEnviar(0), 'Marcá a quién preguntar');
  assert.equal(textoBotonEnviar(3), 'Enviar consulta (3)');
  const html = renderToStaticMarkup(<BarraPreguntar n={2} jornadas={mismo} espera={30} onEspera={() => {}} onEnviar={() => {}} />);
  assert.doesNotMatch(html, /Lugares/);
  assert.match(html, /06\/10 → 15\/10/);
  assert.match(html, /data-consulta-horas[^>]*>El bloque suma 16 h/);
  assert.match(html, /Esperar respuesta:/);
  assert.match(html, /Enviar consulta \(2\)/);
  const marcada = renderToStaticMarkup(
    <TarjetaEventual c={{ ...aballay, topeBloque: 'El bloque (16 h) no entra en el tope (40/50 h)' }} modo="preguntar" marcado={false} onToggle={() => {}} onAsignar={() => {}} />,
  );
  assert.match(marcada, /data-tope-bloque[^>]*>El bloque \(16 h\) no entra en el tope \(40\/50 h\)/);
  const vacia = renderToStaticMarkup(<BarraPreguntar n={0} jornadas={[JORNADA]} espera={30} onEspera={() => {}} onEnviar={() => {}} />);
  assert.match(vacia, /<button[^>]*disabled=""[^>]*data-consulta-enviar[^>]*>Marcá a quién preguntar<\/button>/);
});

test('asignar directo pide confirmación corta y avisa que no se le pregunta', () => {
  assert.equal(textoConfirmarAsignacion('ABALLAY, Juan'), 'Asignar a ABALLAY sin preguntarle. Se arma el contrato y el alta ARCA al guardar.');
  const sel = renderToStaticMarkup(<ModoEventualesSelector modo="asignar" onModo={() => {}} />);
  assert.match(sel, /data-eventuales-modo="asignar"/);
  assert.match(sel, /Preguntar disponibilidad/);
  assert.match(sel, /recomendado/);
  assert.match(sel, /No se le pregunta: al tocar la tarjeta queda asignado\./);
  const conf = renderToStaticMarkup(<ConfirmarAsignacion nombre="ABALLAY, Juan" onConfirmar={() => {}} onCancelar={() => {}} />);
  assert.match(conf, /data-asignar-confirmar/);
  assert.match(conf, /Asignar a ABALLAY sin preguntarle/);
  assert.match(conf, /data-asignar-ok/);
});

test('la tarjeta es compacta: nombre, horas del mes, distancia y teléfono; la casilla solo al preguntar', () => {
  const preguntar = renderToStaticMarkup(<TarjetaEventual c={aballay} modo="preguntar" marcado={false} onToggle={() => {}} onAsignar={() => {}} />);
  assert.match(preguntar, /data-consulta-cuil="20111111112"/);
  assert.match(preguntar, /16\/50 h este mes/);
  assert.match(preguntar, /4\.2 km/);
  assert.match(preguntar, /351-555/);
  assert.doesNotMatch(preguntar, /text-rose/);
  assert.doesNotMatch(preguntar, /Confiabilidad/);
  const asignar = renderToStaticMarkup(<TarjetaEventual c={aballay} modo="asignar" marcado={false} onToggle={() => {}} onAsignar={() => {}} />);
  assert.doesNotMatch(asignar, /data-consulta-cuil/);
  assert.match(asignar, /title="Asignar a ABALLAY, Juan"/);
});

test('los bloqueados van colapsados en «No disponibles (n)» con el motivo y el link a la ficha', () => {
  const html = renderToStaticMarkup(<NoDisponiblesLista rows={bloqueados} />);
  assert.match(html, /<details[^>]*data-no-disponibles="3"/);
  assert.match(html, /No disponibles \(3\)/);
  assert.match(html, /Sin contrato marco vigente\./);
  assert.match(html, /href="\/admin\/rrhh\/eventuales\/\?cuil=20222222223"[^>]*data-ficha-accion="SIN_MARCO"[^>]*>Cargar marco/);
  assert.match(html, /data-ficha-accion="CREDENCIAL_VENCIDA"[^>]*>Cargar vencimiento de credencial/);
  assert.doesNotMatch(html, /data-ficha-accion="DESCANSO_12H"/);
});

test('el resumen del día muestra la consulta en vivo: esperando, aceptó, venció', () => {
  const abierta = {
    status: 'ABIERTA', venceAtMs: Date.UTC(2026, 9, 6, 14, 15), jornadas: [{ fecha: '2026-10-06' }],
    respuestas: [
      { nombre: 'ABALLAY, Juan', estado: 'PENDIENTE', hora: null },
      { nombre: 'BRIZUELA, Ana', estado: 'PENDIENTE', hora: null },
      { nombre: 'CASAS, Luis', estado: 'NO', hora: '10:20' },
    ],
  };
  assert.equal(resumenConsultaDia(abierta), 'Consultados: 3 · esperando respuesta (vence 11:15) · 1 no');
  const aceptada = { ...abierta, status: 'COMPLETA', respuestas: [{ nombre: 'ABALLAY, Juan', estado: 'ASIGNADO', hora: '10:42' }, { nombre: 'BRIZUELA, Ana', estado: 'CUBIERTO', hora: null }] };
  assert.equal(resumenConsultaDia(aceptada), 'ABALLAY aceptó 10:42 → suplente');
  assert.equal(resumenConsultaDia({ ...abierta, status: 'VENCIDA' }), 'Consultados: 3 · venció sin respuesta · 1 no');
  assert.equal(resumenConsultaDia(null), null);
  const otroDia = { ...abierta, jornadas: [{ fecha: '2026-10-07' }] };
  assert.equal(consultaDelDia([otroDia, aceptada], '2026-10-06'), aceptada);
  assert.equal(consultaDelDia([otroDia], '2026-10-06'), null);

  // Columna izquierda del modal v2: la consulta en vivo manda sobre el borrador local.
  const esperando = estadoDiaCobertura({ activo: true, cobertura: { mode: 'none' }, consulta: abierta });
  assert.deepEqual(esperando, { tipo: 'consultando', tono: 'indigo', texto: 'Consultando · vence 11:15' });
  const acepto = estadoDiaCobertura({ activo: true, cobertura: { mode: 'substitute', nombre: 'SUAREZ, Ana' }, consulta: aceptada });
  assert.deepEqual(acepto, { tipo: 'acepto', tono: 'emerald', texto: 'ABALLAY aceptó 10:42' });
  assert.deepEqual(estadoDiaCobertura({ activo: true, cobertura: { mode: 'none' }, consulta: { ...abierta, status: 'VENCIDA' } }), { tipo: 'sin_cubrir', tono: 'rose', texto: 'Sin cubrir' });
  assert.deepEqual(estadoDiaCobertura({ activo: true, cobertura: { mode: 'substitute', nombre: 'SUAREZ, Ana' } }), { tipo: 'suplente', tono: 'emerald', texto: 'Suplente · SUAREZ' });
  assert.deepEqual(estadoDiaCobertura({ activo: true, cobertura: { mode: 'split', ext: 'LIZARRAGA, Hugo', adel: 'RODRIGUEZ, Lia' } }), { tipo: 'split', tono: 'violet', texto: 'Ext+Adel · LIZARRAGA / RODRIGUEZ' });
  assert.deepEqual(estadoDiaCobertura({ activo: false, cobertura: { mode: 'none' } }), { tipo: 'no_procesa', tono: 'slate', texto: 'No se procesa' });

  const box = renderToStaticMarkup(
    <ConsultaDiaBox estado={esperando} resumen={resumenConsultaDia(abierta)} abierta onCancelar={() => {}} />,
  );
  assert.match(box, /data-consulta-dia="consultando"/);
  assert.match(box, /Consultando · vence 11:15/);
  assert.match(box, /Consultados: 3 · esperando respuesta \(vence 11:15\) · 1 no/);
  assert.match(box, /data-consulta-dia-cancelar/);
  assert.match(box, /Cancelar consulta/);
  const boxOk = renderToStaticMarkup(<ConsultaDiaBox estado={acepto} resumen={resumenConsultaDia(aceptada)} abierta={false} onCancelar={() => {}} />);
  assert.match(boxOk, /data-consulta-dia="acepto"/);
  assert.match(boxOk, /ABALLAY aceptó 10:42/);
  assert.doesNotMatch(boxOk, /Cancelar consulta/);
});

test('la franja dice qué se cubre y los textos del modal v2 son los del boceto', () => {
  assert.equal(textoCubrir({ code: 'M', positionName: 'Puesto 1', scheduleLabel: '10:45–12:00', hours: 1.25 }), 'M · Puesto 1 · 10:45–12:00 (1,25 h)');
  assert.equal(textoCubrir({ code: 'T', positionName: 'Recepción', scheduleLabel: '15:00–23:00', hours: 8 }), 'T · Recepción · 15:00–23:00 (8 h)');
  assert.equal(textoCubrir(null), 'Sin turno que cubrir ese día');
  assert.equal(textoRangoDias(['2026-10-06']), '1 día · 06/10');
  assert.equal(textoRangoDias(['2026-10-10', '2026-10-06', '2026-10-08']), '3 días · 06/10 → 10/10');
  assert.equal(textoBarraAsignar('FERRERO, Juan', '2026-10-08', 'M', '10:45–12:00'), 'FERRERO cubre el 08/10 · M 10:45–12:00');
  assert.equal(textoBarraAsignar(null, '2026-10-08'), 'Tocá un guardia para asignarlo a este día');
  assert.equal(textoBotonAsignar('FERRERO, Juan'), 'Asignar a FERRERO');
  assert.equal(textoBotonAsignar(null), 'Elegí un guardia');
  assert.equal(textoBarraSplit('LIZARRAGA, Hugo', 'RODRIGUEZ, Lia'), 'LIZARRAGA se extiende y RODRIGUEZ adelanta');
  assert.equal(textoBarraSplit('LIZARRAGA, Hugo', null), 'LIZARRAGA se extiende · falta quién adelanta');
  assert.equal(textoBarraSplit(null, null), 'Elegí quién se extiende y quién adelanta');
  assert.equal(textoAccionPrincipal(true), 'Confirmar cobertura');
  assert.equal(textoAccionPrincipal(false), 'Dejar vacante');

  const franja = renderToStaticMarkup(
    <CoberturaFranja
      titular="BAEZ, Carlos"
      motivo="Ausencia médica"
      codigo="E"
      rango="1 día · 06/10"
      diaLabel="06/10"
      cubrir="M · Puesto 1 · 10:45–12:00 (1,25 h)"
      bandas={[{ value: 'M__Puesto 1', label: 'M · Puesto 1 · 10:45–12:00 (1.25 h)' }]}
      bandaValue="M__Puesto 1"
      onBanda={() => {}}
      onClose={() => {}}
    />,
  );
  assert.match(franja, /data-cobertura-titular[^>]*>BAEZ, Carlos</);
  assert.match(franja, /Cubrir · 06\/10/);
  assert.match(franja, /M · Puesto 1 · 10:45–12:00 \(1,25 h\)/);
  // Una sola banda posible: no hay selector.
  assert.doesNotMatch(franja, /data-cobertura-banda/);
  const franjaDos = renderToStaticMarkup(
    <CoberturaFranja
      titular="BAEZ, Carlos" motivo="Ausencia médica" codigo="E" rango="1 día · 06/10" diaLabel="06/10" cubrir="M · Puesto 1"
      bandas={[{ value: 'M__P1', label: 'M' }, { value: 'T__P1', label: 'T' }]} bandaValue="M__P1" onBanda={() => {}} onClose={() => {}}
    />,
  );
  assert.match(franjaDos, /data-cobertura-banda/);
});

test('la columna de días marca, selecciona, quita y aplica a los marcados; el pie tiene solo Cerrar y la acción', () => {
  const dias = renderToStaticMarkup(
    <CoberturaDias
      dias={[
        { date: '2026-10-06', label: 'mar 06/10', activo: true, seleccionado: false, estado: { tipo: 'suplente', tono: 'emerald', texto: 'Suplente · SUAREZ' }, puedeQuitar: true },
        { date: '2026-10-07', label: 'mié 07/10', activo: true, seleccionado: true, estado: { tipo: 'sin_cubrir', tono: 'rose', texto: 'Sin cubrir' }, puedeQuitar: false },
        { date: '2026-10-08', label: 'jue 08/10', activo: true, seleccionado: false, estado: { tipo: 'consultando', tono: 'indigo', texto: 'Consultando · vence 11:15' }, puedeQuitar: false },
        { date: '2026-10-09', label: 'vie 09/10', activo: false, seleccionado: false, estado: { tipo: 'no_procesa', tono: 'slate', texto: 'No se procesa' }, puedeQuitar: false },
      ]}
      onSeleccionar={() => {}}
      onMarcar={() => {}}
      onTodos={() => {}}
      onNinguno={() => {}}
      onQuitar={() => {}}
      aplicarMarcados={{ n: 3, habilitado: true, onClick: () => {} }}
      completar={{ texto: 'Completar 1 día(s) sin cobertura con la de 06/10', onClick: () => {} }}
    />,
  );
  assert.match(dias, /3 de 4 marcados/);
  assert.match(dias, /data-cobertura-dia="2026-10-07"[^>]*data-cobertura-estado="sin_cubrir"[^>]*data-cobertura-seleccionado="1"/);
  assert.match(dias, /data-cobertura-estado="consultando"/);
  assert.match(dias, /data-cobertura-quitar="2026-10-06"/);
  assert.doesNotMatch(dias, /data-cobertura-quitar="2026-10-07"/);
  assert.match(dias, /Aplicar esta cobertura a los 3 días marcados/);
  assert.match(dias, /Completar 1 día\(s\) sin cobertura con la de 06\/10/);
  assert.match(dias, /data-cobertura-todos/);
  assert.doesNotMatch(dias, /Aplicar a este día/);
  assert.doesNotMatch(dias, /Siguiente día/);

  const pie = renderToStaticMarkup(<CoberturaPie accion={textoAccionPrincipal(true)} onAccion={() => {}} onCerrar={() => {}} />);
  assert.match(pie, /data-cobertura-cerrar[^>]*>Cerrar</);
  assert.match(pie, /data-cobertura-principal[^>]*>Confirmar cobertura</);
  assert.doesNotMatch(pie, /Cancelar/);
  assert.doesNotMatch(pie, /Listo/);
  assert.doesNotMatch(pie, /Marcar vacante/);

  // La barra siempre dice qué hace el botón, también deshabilitado (texto gris sobre blanco, nunca invisible).
  const barra = renderToStaticMarkup(<CoberturaBarra texto="Tocá un guardia para asignarlo a este día" boton="Elegí un guardia" disabled onClick={() => {}} />);
  assert.match(barra, /<button[^>]*disabled=""[^>]*data-cobertura-accion[^>]*>Elegí un guardia</);
  assert.match(barra, /disabled:bg-white disabled:text-slate-500/);

  const tabs = renderToStaticMarkup(<CoberturaTabs tab="nomina" onTab={() => {}} eventuales split />);
  assert.match(tabs, /aria-selected="true"[^>]*data-cobertura-tab="nomina"/);
  assert.match(tabs, /Eventuales/);
  assert.match(tabs, /Ext \+ Adel/);
  const sinEventuales = renderToStaticMarkup(<CoberturaTabs tab="nomina" onTab={() => {}} eventuales={false} split />);
  assert.doesNotMatch(sinEventuales, /data-cobertura-tab="eventuales"/);
  const modo = renderToStaticMarkup(<ModoCoberturaSwitch modo="preguntar" onModo={() => {}} puedePreguntar />);
  assert.match(modo, /data-cobertura-modo="preguntar"/);
  assert.match(modo, /Asignar directo/);
  assert.equal(renderToStaticMarkup(<ModoCoberturaSwitch modo="asignar" onModo={() => {}} puedePreguntar={false} />), '');

  const fila = renderToStaticMarkup(
    <FilaCandidatoNomina
      c={{ id: 'e1', nombre: 'FERRERO, Juan', meta: '142 h este mes · 3 km', tag: 'Libre', tono: 'emerald' }}
      modo="preguntar" marcado seleccionado={false} onToggle={() => {}} onElegir={() => {}}
    />,
  );
  assert.match(fila, /data-consulta-nomina="e1"[^>]*checked=""/);
  assert.match(fila, /FERRERO, Juan/);
  const filaAsignar = renderToStaticMarkup(
    <FilaCandidatoNomina
      c={{ id: 'e2', nombre: 'GOMEZ, Ana', meta: '160 h este mes', tag: 'Franco · FT', tono: 'violet', nota: 'franco trabajado · pide PIN' }}
      modo="asignar" marcado={false} seleccionado onToggle={() => {}} onElegir={() => {}}
    />,
  );
  assert.doesNotMatch(filaAsignar, /type="checkbox"/);
  assert.match(filaAsignar, /data-candidato-activo="1"/);
  assert.match(filaAsignar, /pide PIN/);
  const noDisp = renderToStaticMarkup(<NoDisponiblesNomina rows={[{ id: 'e3', nombre: 'LOPEZ, Raul', motivo: 'En servicio ese día' }]} />);
  assert.match(noDisp, /data-no-disponibles="1"/);
  assert.match(noDisp, /No disponibles \(1\)/);
  assert.match(noDisp, /En servicio ese día/);
});

test('el tema de la empresa no pisa el botón deshabilitado ni pone blanco sobre un color claro', () => {
  const css = buildBrandCSS();
  // Los fondos rellenos solo se pintan con el color de la empresa cuando el botón está habilitado.
  assert.match(css, /\.bg-indigo-600:not\(:disabled\):not\(\[aria-disabled="true"\]\)/);
  assert.match(css, /\.bg-violet-600:not\(:disabled\)/);
  assert.doesNotMatch(css, /\.bg-indigo-600,\s*\n/);
  // Y usan el color apto para texto blanco, no el color crudo.
  assert.match(css, /\.bg-indigo-500:not\(:disabled\)[^{]*\{ background-color: var\(--company-primary-btn\)/);
  // Color claro (blanco encima < 4,5:1) → tono oscuro; gris → casi negro; índigo o azul → el mismo.
  assert.equal(companyButtonColor('#4f46e5'), '#4f46e5');
  assert.equal(companyButtonColor('#1d4ed8'), '#1d4ed8');
  assert.equal(companyButtonColor('#d1d5db'), '#111827');
  assert.notEqual(companyButtonColor('#fde68a'), '#fde68a');
  assert.notEqual(companyButtonColor('#22c55e'), '#22c55e', 'verde claro: blanco encima no llega a AA');
  assert.equal(buildCompanyTheme('#fde68a')['--company-primary-btn'], companyButtonColor('#fde68a'));
  assert.equal(buildCompanyTheme('#4f46e5')['--company-primary-btn-text'], '#ffffff');
});

test('el celular cubre un hueco sin «Lugares» y colapsa a los no disponibles', () => {
  const html = renderToStaticMarkup(
    <div data-viewport="390x844" className="max-w-[390px]">
      <CandidatosHueco
        tab="eventuales"
        onTab={() => {}}
        candidatos={[]}
        eventuales={[
          { cuil: '20111111112', nombre: 'ABALLAY, Juan', distanciaKm: 4.2, motivo: null, elegible: true },
          { cuil: '20222222223', nombre: 'BRIZUELA, Ana', distanciaKm: null, motivo: 'Sin contrato marco vigente.', motivoCodigo: 'SIN_MARCO', elegible: false },
        ]}
        elegidoId={null}
        puedeFt
        puedeEventuales
        onElegir={() => {}}
        onConfirmar={() => {}}
        consultaCuils={['20111111112']}
        onToggleConsulta={() => {}}
        onConsultar={() => {}}
      />
    </div>,
  );
  assert.doesNotMatch(html, /Lugares/);
  assert.doesNotMatch(html, /data-consulta-lugares/);
  assert.match(html, /Preguntar a 1 · el primero que acepte cubre el turno/);
  assert.match(html, /Enviar consulta \(1\)/);
  assert.match(html, /data-no-disponibles="1"/);
  assert.match(html, /No disponibles \(1\)/);
  assert.doesNotMatch(html, /data-plan-candidato="20222222223"/);
});

test('un día con consulta abierta no guarda el suplente local y la celda avisa', () => {
  const consulta = {
    id: 'c1',
    status: 'ABIERTA',
    venceAtMs: Date.UTC(2026, 9, 6, 14, 15),
    titularEmployeeId: 'titular',
    positionName: 'Puesto 1',
    jornadas: [{ fecha: '2026-10-06', code: 'M' }],
    respuestas: [
      { nombre: 'ABALLAY, Juan', estado: 'PENDIENTE', hora: null },
      { nombre: 'BRIZUELA, Ana', estado: 'NO', hora: '10:20' },
    ],
  };
  const changes: Record<string, { code: string; isDeleted?: boolean; employeeId?: string; hours?: number }> = {
    'titular_2026-10-06': { code: 'L', isDeleted: false },
    'suplente_2026-10-06': { code: 'M', employeeId: 'suplente', hours: 8 },
    'otro_2026-10-07': { code: 'T' },
  };
  const sane = quitarBorradorQuePisaConsulta(changes, [consulta]);
  assert.deepEqual(sane.quitadas, ['suplente_2026-10-06']);
  assert.equal(sane.changes['titular_2026-10-06'].code, 'L');
  assert.equal(sane.changes['otro_2026-10-07'].code, 'T');
  assert.equal(sane.changes['suplente_2026-10-06'], undefined);
  assert.equal(diaLoResuelveConsulta([consulta], '2026-10-06'), true);
  assert.equal(consultaAbiertaEnFecha([consulta], '2026-10-06', 'titular')?.id, 'c1');
  assert.equal(consultaAbiertaEnFecha([consulta], '2026-10-06', 'otro'), null);
  assert.equal(textoIndicadorConsulta(consulta), 'Consulta enviada · vence 11:15');
  assert.match(textoTooltipConsulta(consulta), /ABALLAY esperando/);
  assert.match(textoTooltipConsulta(consulta), /BRIZUELA no/);

  const manual = cambiosManualesSobreConsulta(
    {},
    { 'titular_2026-10-06': { code: 'M' } },
    [consulta],
  );
  assert.equal(manual[0]?.consultaId, 'c1');
  const licencia = cambiosManualesSobreConsulta(
    {},
    { 'titular_2026-10-06': { code: 'L' } },
    [consulta],
  );
  assert.equal(licencia.length, 0);

  const acepto = novedadesDeConsultas([consulta], [{
    ...consulta,
    respuestas: [{ nombre: 'ABALLAY, Juan', estado: 'ASIGNADO', hora: '10:42' }],
  }]);
  assert.equal(acepto[0]?.tipo, 'ACEPTO');
  assert.equal(acepto[0]?.texto, textoToastAcepto('ABALLAY, Juan', '2026-10-06', 'M', 'Puesto 1'));
  assert.equal(novedadesDeConsultas([consulta], [consulta]).length, 0);
  const vencida = novedadesDeConsultas([consulta], [{ ...consulta, status: 'VENCIDA' }]);
  assert.equal(vencida[0]?.tipo, 'VENCIDA');
  assert.match(vencida[0]?.texto || '', /venció sin respuesta/);

  const pill = renderToStaticMarkup(
    <ConsultasEnCursoPill
      consultas={[consulta, { ...consulta, id: 'c2', status: 'VENCIDA', respuestas: [{ nombre: 'CASAS, Luis', estado: 'NO', hora: null }] }]}
      focoId="c2"
      onCancelar={() => {}}
      onConsultarOtros={() => {}}
      onCubrirOtraForma={() => {}}
    />,
  );
  assert.match(pill, /Consultas en curso \(1\)/);
  assert.match(pill, /data-consulta-cancelar="c1"/);
  assert.match(pill, /Cancelar consulta/);
  assert.match(pill, /data-consulta-otros="c2"/);
  assert.match(pill, /Consultar a otros/);
  assert.match(pill, /Cubrir de otra forma/);
  const celda = renderToStaticMarkup(
    <IndicadorConsultaCelda texto={textoIndicadorConsulta(consulta)} tooltip={textoTooltipConsulta(consulta)} onAbrir={() => {}} />,
  );
  assert.match(celda, /data-consulta-celda="1"/);
  assert.match(celda, /Consulta enviada · vence 11:15/);
});
