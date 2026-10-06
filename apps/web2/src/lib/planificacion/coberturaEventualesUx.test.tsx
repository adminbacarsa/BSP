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
import { VacancyCoberturaLista } from '@/components/planificacion/VacancyCoberturaDia';
import { CandidatosHueco } from '@/components/movil/PlanificacionMovilView';
import {
  accionParaMotivo,
  consultaDelDia,
  linkFichaEventual,
  resumenConsultaDia,
  separarCandidatos,
  textoBarraPreguntar,
  textoBotonEnviar,
  textoConfirmarAsignacion,
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

test('la barra de preguntar nombra el turno, sin «Lugares»; con varios días dice cuántos cubre', () => {
  assert.equal(textoBarraPreguntar(0, [JORNADA]), 'Marcá a quién preguntar');
  assert.equal(textoBarraPreguntar(3, [JORNADA]), 'Preguntar a 3 · el primero que acepte cubre 06/10 · M 10:45–12:00');
  assert.equal(textoBarraPreguntar(2, [JORNADA, { ...JORNADA, fecha: '2026-10-07' }, { ...JORNADA, fecha: '2026-10-08' }]), 'Preguntar a 2 · el primero que acepte cubre los 3 días marcados');
  assert.equal(textoBotonEnviar(0), 'Marcá a quién preguntar');
  assert.equal(textoBotonEnviar(3), 'Enviar consulta (3)');
  const html = renderToStaticMarkup(<BarraPreguntar n={3} jornadas={[JORNADA]} espera={30} onEspera={() => {}} onEnviar={() => {}} />);
  assert.doesNotMatch(html, /Lugares/);
  assert.match(html, /Esperar respuesta:/);
  assert.match(html, /30 min/);
  assert.match(html, /hasta el inicio/);
  assert.match(html, /Enviar consulta \(3\)/);
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

  const lista = renderToStaticMarkup(
    <VacancyCoberturaLista
      days={[{ date: '2026-10-06', label: 'Mar 06', coverageLabel: 'Sin cobertura', mode: 'none', editing: false, titular: 'M · 10:45–12:00', consulta: resumenConsultaDia(abierta) }]}
      emptyCount={1}
      templateLabel={null}
      onEdit={() => {}}
      onClear={() => {}}
      onCompleteRemaining={() => {}}
    />,
  );
  assert.match(lista, /data-cobertura-consulta="2026-10-06"[^>]*>Consultados: 3 · esperando respuesta \(vence 11:15\) · 1 no</);
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
