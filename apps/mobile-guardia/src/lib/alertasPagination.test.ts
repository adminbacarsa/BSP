import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTAS_PAGE_SIZE, paginateAlertItems } from './alertasPagination.ts';

describe('paginateAlertItems', () => {
  it('nunca devuelve más de 10 por ventana', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const p0 = paginateAlertItems(items, 0);
    assert.equal(p0.pageItems.length, ALERTAS_PAGE_SIZE);
    assert.equal(p0.from, 1);
    assert.equal(p0.to, 10);
    assert.equal(p0.totalPages, 3);

    const p1 = paginateAlertItems(items, 1);
    assert.equal(p1.pageItems.length, 10);
    assert.deepEqual(p1.pageItems, items.slice(10, 20));

    const p2 = paginateAlertItems(items, 2);
    assert.equal(p2.pageItems.length, 5);
    assert.equal(p2.from, 21);
    assert.equal(p2.to, 25);
  });

  it('clampa página fuera de rango', () => {
    const items = [1, 2, 3];
    const r = paginateAlertItems(items, 99);
    assert.equal(r.safePage, 0);
    assert.equal(r.pageItems.length, 3);
  });

  it('lista vacía', () => {
    const r = paginateAlertItems([], 0);
    assert.equal(r.total, 0);
    assert.equal(r.pageItems.length, 0);
    assert.equal(r.from, 0);
    assert.equal(r.to, 0);
  });
});
