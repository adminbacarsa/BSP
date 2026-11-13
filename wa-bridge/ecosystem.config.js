module.exports = {
  apps: [
    {
      name:        'wa-bacarsa',
      script:      'wa-bridge.js',
      cwd:         __dirname,
      instances:   1,
      autorestart: true,
      watch:       false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV:    'production',
        PORT:        7291,
        WA_AUTH_DIR: '.wa_auth_bacarsa',
      },
      error_file:  './logs/err-bacarsa.log',
      out_file:    './logs/out-bacarsa.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:        'wa-pruebas',
      script:      'wa-bridge.js',
      cwd:         __dirname,
      instances:   1,
      autorestart: true,
      watch:       false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV:    'production',
        PORT:        7292,
        WA_AUTH_DIR: '.wa_auth_pruebas',
      },
      error_file:  './logs/err-pruebas.log',
      out_file:    './logs/out-pruebas.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
