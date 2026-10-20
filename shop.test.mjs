import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, createShop, money } from './dist/shop.js';

/** Build a small inventory with repeated units and exact catalog pricing. */
function fixture() {
  return createShop(CATALOG, [
    { /** Unit id. */ id: 'milk-1', /** Catalog id. */ productId: 'milk' },
    { /** Unit id. */ id: 'milk-2', /** Catalog id. */ productId: 'milk' },
    { /** Unit id. */ id: 'chips-1', /** Catalog id. */ productId: 'chips' },
  ]);
}

test('inspection reserves one physical unit and return restores that exact slot', () => {
  const shop = fixture();
  assert.equal(shop.pick('missing'), false);
  assert.equal(shop.pick('milk-1'), true);
  assert.equal(shop.pick('milk-2'), false);
  assert.equal(shop.getState().held.id, 'milk');
  assert.equal(shop.getState().available.has('milk-1'), false);
  assert.equal(shop.putBack(), true);
  assert.equal(shop.getState().available.has('milk-1'), true);
  assert.equal(shop.getState().held, null);
});

test('cart quantity, stock and integer-cent totals stay in sync', () => {
  const shop = fixture();
  shop.pick('milk-1'); shop.addHeld();
  assert.equal(shop.pick('milk-1'), false);
  assert.equal(shop.addOne('milk'), true);
  assert.equal(shop.addOne('milk'), false);
  shop.pick('chips-1'); shop.addHeld();
  assert.equal(shop.getState().quantity, 3);
  assert.equal(shop.getState().total, 2290);
  assert.equal(money(shop.getState().total), '22.90');
  assert.equal(shop.remove('milk'), true);
  assert.equal(shop.getState().total, 1640);
  assert.equal(shop.getState().available.has('milk-2'), true);
});

test('checkout locks its snapshot, completes once and leaves purchased units sold', () => {
  const shop = fixture();
  assert.equal(shop.beginCheckout(), null);
  shop.pick('milk-1'); shop.addHeld();
  shop.pick('chips-1');
  assert.equal(shop.beginCheckout(), null);
  shop.putBack();
  const order = shop.beginCheckout();
  assert.equal(order.total, 650);
  order.lines[0].quantity = 99;
  assert.equal(shop.beginCheckout(), null);
  assert.equal(shop.remove('milk'), false);
  assert.equal(shop.addOne('milk'), false);
  assert.equal(shop.pick('milk-2'), false);
  const receipt = shop.finishCheckout();
  assert.equal(receipt.lines[0].quantity, 1);
  assert.equal(receipt.total, 650);
  assert.equal(receipt.number, 1);
  assert.equal(shop.finishCheckout(), null);
  assert.equal(shop.getState().quantity, 0);
  assert.equal(shop.getState().available.has('milk-1'), false);
  assert.equal(shop.pick('milk-2'), true);
});
