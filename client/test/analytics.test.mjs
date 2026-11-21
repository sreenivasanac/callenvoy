// The address sent to analytics must carry no ids, queries or fragments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeOnly } from '../src/platform/analytics.web.ts';

test('routeOnly keeps the route and drops everything identifying', () => {
  assert.equal(routeOnly('/calls/9f2c1e?x=1#t'), '/calls/:id');
  assert.equal(routeOnly('https://callenvoy.pragnyalabs.com/signin?token=abc'), '/signin');
  assert.equal(routeOnly('/?signin=1'), '/');
  assert.equal(routeOnly('/connect?code=secret&state=1'), '/connect');
  assert.equal(routeOnly('/people'), '/people');
});
