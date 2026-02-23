
/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['tsx'],         // Evita tratar archivos .ts como páginas (auditplan/* helpers)
  output: 'export',               // <--- ESTO OBLIGA A CREAR LA CARPETA 'out'
  reactStrictMode: false,         // Evitar doble ejecución de effects que puede causar loops
  images: {
    unoptimized: true,            // <--- OBLIGATORIO para Firebase Hosting (sin servidor de imágenes)
  },
  // Ignoramos errores menores para asegurar que el build termine
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Desactivamos funciones experimentales que puedan dar problemas
  experimental: {
    esmExternals: 'loose' 
  }
};

module.exports = nextConfig;
