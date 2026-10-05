// Solo para los tests de render en Node (react-dom no trae tipos propios en este workspace).
declare module 'react-dom/server' {
  import type { ReactElement } from 'react';
  export function renderToStaticMarkup(element: ReactElement): string;
  export function renderToString(element: ReactElement): string;
}
