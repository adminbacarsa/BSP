const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let gitHash = 'local';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch (_) {}

const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

let appVersion = '0.0.0';
try {
  appVersion = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
  ).version;
} catch (_) {}

// ── Fuente única de verdad para el nombre de la app ──────────────────────────
const APP_NAME    = 'COSP V 1.0';
const APP_SUBTITLE = 'Seguridad Privada · Grupo Bacar';

// Genera manifest.json en cada build para que el nombre esté siempre actualizado
const manifest = {
  name: `${APP_NAME} · Control Operativo de Seguridad Privada`,
  short_name: APP_NAME,
  description: 'Gestión de personal, planificación de turnos y monitoreo en tiempo real.',
  start_url: '/admin/dashboard/',
  scope: '/',
  display: 'standalone',
  display_override: ['window-controls-overlay'],
  background_color: '#f8fafc',
  theme_color: '#ffffff',
  orientation: 'any',
  lang: 'es',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    { src: '/icons/icon.svg',     sizes: 'any',     type: 'image/svg+xml' },
  ],
  categories: ['business', 'productivity'],
};
fs.writeFileSync(path.join(__dirname, 'public', 'manifest.json'), JSON.stringify(manifest, null, 2));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // COOP/COEP: habilitan SharedArrayBuffer → onnxruntime-web → bg removal (@imgly)
  // En `next dev` aplica automáticamente. En prod: firebase.json tiene los mismos headers.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',  value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  distDir: process.env.NEXT_DIST_DIR || '.next',
  pageExtensions: ['tsx', 'ts'],
  output: 'export',
  trailingSlash: true,
  reactStrictMode: false,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BUILD_HASH: gitHash,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_NAME: APP_NAME,
    NEXT_PUBLIC_APP_SUBTITLE: APP_SUBTITLE,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    esmExternals: 'loose'
  },
  transpilePackages: ['onnxruntime-web'],
  staticPageGenerationTimeout: 300,
  webpack: (config, { dev }) => {
    // Soporte WASM para @imgly/background-removal
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };
    // Fix import.meta en .mjs de onnxruntime-web
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });
    // En Windows, fs.watch a veces no detecta cambios hechos por herramientas externas.
    // Polling garantiza que Next.js recompile siempre que cambie un archivo.
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.next/**', '**/out/**'],
      };
    }
    return config;
  }
};

module.exports = nextConfig;
