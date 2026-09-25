import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * HTML raíz del export estático web (`expo export`).
 * Inyecta PWA meta + manifest bajo /app.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es-AR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, shrink-to-fit=no"
        />
        <title>COSP Guardia</title>
        <meta name="description" content="Portal del vigilador — turnos, fichada GPS y novedades." />
        <meta name="theme-color" content="#8B1A1A" />
        <meta name="application-name" content="COSP Guardia" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="COSP" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/app/manifest.webmanifest" />
        <link rel="icon" href="/app/favicon.ico" />
        <link rel="apple-touch-icon" href="/app/icons/icon-192.png" />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            // 100dvh = alto visible real (Safari iOS: 100% incluye la barra del navegador y tapa las pestañas).
            __html: `body,html{height:100%}#root{height:100%;height:100dvh}body{overflow:hidden;background:#8B1A1A}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
