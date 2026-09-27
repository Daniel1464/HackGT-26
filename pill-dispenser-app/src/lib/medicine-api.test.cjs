const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
function load(filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name.startsWith('./') ? load(`${name.slice(2)}.ts`) : require(name), module, module.exports,
  );
  return module.exports;
}
const { broadcastAndSyncMedicine } = load('medicine-api.ts');
const record = { medicine: 'Vitamin A', id: 0, data: [{ time: '12:30 UTC', dose: 2 }, { time: '22:00 UTC', dose: 1 }] };

test('broadcast and server sync preserve all doses, order, authorization and slot', async t => {
  const oldUrl = process.env.EXPO_PUBLIC_SERVER_API_URL;
  const oldKey = process.env.EXPO_PUBLIC_SERVER_API_KEY;
  t.after(() => {
    for (const [key, value] of [['EXPO_PUBLIC_SERVER_API_URL', oldUrl], ['EXPO_PUBLIC_SERVER_API_KEY', oldKey]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.EXPO_PUBLIC_SERVER_API_URL = 'https://demo.example/';
  process.env.EXPO_PUBLIC_SERVER_API_KEY = 'demo-key';
  const order = [];
  const fetchMock = t.mock.method(global, 'fetch', async (url, options) => {
    order.push('http');
    assert.equal(url, 'https://demo.example/medicines/0/schedule');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['X-API-Key'], 'demo-key');
    assert.deepEqual(JSON.parse(options.body), record);
    return { ok: true };
  });
  await broadcastAndSyncMedicine(record, async value => { assert.deepEqual(value, record); order.push('ble'); });
  assert.deepEqual(order, ['ble', 'http']);
  await assert.rejects(broadcastAndSyncMedicine(record, async () => { throw new Error('BLE failed'); }), /BLE failed/);
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 401 }));
  await assert.rejects(broadcastAndSyncMedicine(record, async () => {}), /sent to the dispenser.*HTTP 401/);
  process.env.EXPO_PUBLIC_SERVER_API_URL = '';
  await assert.rejects(broadcastAndSyncMedicine(record, async () => assert.fail('must validate before BLE')), /SERVER_API_URL/);
});
