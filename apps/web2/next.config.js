const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let gitHash = 'local';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch (_) {}

const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

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
  staticPageGenerationTimeout: 300
};

module.exports = nextConfig;
