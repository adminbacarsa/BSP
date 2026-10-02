import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolbarMenuPanel } from '@/components/planificacion/ToolbarFloatMenu';
import { menuContainedInClip, placeToolbarMenu } from '@/lib/planificacion/toolbarFloatMenu';

const BAR = { top: 48, left: 0, right: 360, bottom: 92 };

test('el menú de la barra se abre fuera del recuadro con overflow', () => {
  const anchor = { top: 56, left: 250, right: 292, bottom: 84 };
  const pos = placeToolbarMenu({
    anchor, menuWidth: 210, menuHeight: 180,
    viewportWidth: 1280, viewportHeight: 800, align: 'end',
  });
  const menu = { top: pos.top, left: pos.left, width: 210, height: Math.min(180, pos.maxHeight) };
  assert.equal(menuContainedInClip(menu, BAR), false);
  assert.ok(menu.top + menu.height > BAR.bottom);
  assert.ok(menu.left + menu.width <= 1280);

  const html = renderToStaticMarkup(
    <div data-viewport="1280x800">
      <div data-plan-toolbar="1" className="overflow-x-auto" style={{ overflowX: 'auto', overflowY: 'auto' }}>
        <button type="button">⋯</button>
      </div>
      <ToolbarMenuPanel pos={pos} menuKey="mas">Lab de casos</ToolbarMenuPanel>
    </div>,
  );
  const barra = html.slice(0, html.indexOf('data-toolbar-menu'));
  assert.equal(barra.includes('Lab de casos'), false);
  assert.match(barra, /overflow-x:auto/);
  assert.match(html, /data-toolbar-menu="mas"/);
  assert.match(html, /position:fixed/);
  assert.match(html, /z-index:9999/);
});

test('voltea arriba si no entra abajo y a la izquierda si no entra a la derecha', () => {
  const abajo = placeToolbarMenu({
    anchor: { top: 620, left: 40, right: 80, bottom: 656 },
    menuWidth: 168, menuHeight: 220,
    viewportWidth: 1280, viewportHeight: 700, align: 'start',
  });
  assert.ok(abajo.top < 620);

  const derecha = placeToolbarMenu({
    anchor: { top: 56, left: 1100, right: 1260, bottom: 84 },
    menuWidth: 210, menuHeight: 160,
    viewportWidth: 1280, viewportHeight: 800, align: 'start',
  });
  assert.ok(derecha.left + 210 <= 1280 - 8);
});
