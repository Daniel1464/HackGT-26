const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');

// Compile only this pure helper in memory; no React Native runtime or board needed.
function load(filename) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}
const { SAMPLE_MEDICINE, medicineDosePacket, validateMedicine } = load('medicine.ts');

test('sample medicine is a valid Vitamin A dose at 10:00 UTC', () => {
  assert.deepEqual(validateMedicine(SAMPLE_MEDICINE), {
    medicine: 'Vitamin A', id: 0, data: [{ time: '10:00 UTC', dose: 1 }],
  });
});

test('sample medicine encodes as medicine ID, minute of day and dose', () => {
  const packet = new DataView(medicineDosePacket(SAMPLE_MEDICINE, SAMPLE_MEDICINE.data[0]));
  assert.equal(packet.getUint8(0), 0);
  assert.equal(packet.getUint16(1, true), 600);
  assert.equal(packet.getUint32(3, true), 1);
});
