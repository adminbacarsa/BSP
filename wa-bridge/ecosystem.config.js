// Un proceso de bridge por empresa (puerto, sesión de WhatsApp y logs propios).
// Para dar de alta una empresa nueva NO se edita a mano: `node alta-empresa.js` (en el servidor)
// lee las empresas de la plataforma, agrega la línea entre las marcas EMPRESAS:START / EMPRESAS:END,
// la ruta de caddy, arranca el proceso y entrega la ficha con las direcciones y los datos de la plataforma.
//
// responder: true  → el bridge le escribe al guardia por privado (confirmación de presencia,
//                    avisos por ubicación estática o solo texto). Equivale a WA_RESPONDER=1.
// El envío de avisos desde la planilla (/send) no depende de este valor.

// EMPRESAS:START
const EMPRESAS = [
  { slug: 'bacarsa', port: 7291, responder: false },
  { slug: 'pruebas', port: 7292, responder: true },
];
// EMPRESAS:END

module.exports = {
  apps: EMPRESAS.map((e) => ({
    name:        `wa-${e.slug}`,
    script:      'wa-bridge.js',
    cwd:         __dirname,
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV:    'production',
      PORT:        e.port,
      WA_AUTH_DIR: `.wa_auth_${e.slug}`,
      ...(e.responder ? { WA_RESPONDER: '1' } : {}),
    },
    error_file:  `./logs/err-${e.slug}.log`,
    out_file:    `./logs/out-${e.slug}.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  })),
};
