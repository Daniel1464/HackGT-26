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
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}
const {
  buildMedicationRows,
  describeDoseCount,
  describeMedicationRow,
  parseRegisteredMedicines,
} = load('medication-table.ts');

test('reads the registry payload, dropping unusable slots, names and doses', () => {
  const parsed = parseRegisteredMedicines({
    timezone: 'UTC',
    medicines: [
      {
        id: 0,
        name: 'Vitamin A',
        time_to_take: '08:00',
        data: [{ time: '08:00 UTC', dose: 2 }, { time: '20:00 UTC', dose: 1 }],
      },
      {
        id: 1,
        name: '  Ibuprofen ',
        time_to_take: '09:30',
        data: [{ time: '25:00 UTC', dose: 1 }, { time: '08:00 UTC', dose: 0 }, { time: '08:00 UTC' }, 'nope'],
      },
      { id: 2, name: 'Unknown slot', time_to_take: '10:00' },
      { id: 0, name: '   ' },
      null,
    ],
  });
  assert.deepEqual(parsed, [
    {
      slot: 0,
      name: 'Vitamin A',
      doses: [{ time: '08:00 UTC', dose: 2 }, { time: '20:00 UTC', dose: 1 }],
      fallbackTime: '08:00',
    },
    { slot: 1, name: 'Ibuprofen', doses: [], fallbackTime: '09:30' },
  ]);
});

test('rejects payloads that are not a medicines list', () => {
  assert.throws(() => parseRegisteredMedicines({ timezone: 'UTC' }), /medicines list/);
  assert.throws(() => parseRegisteredMedicines(null), /medicines list/);
  assert.deepEqual(parseRegisteredMedicines({ medicines: [] }), []);
});

test('merges both sources, preferring what the dispenser holds', () => {
  const rows = buildMedicationRows(
    [{ id: 0, medicineName: 'Vitamin A' }, { id: 1, medicineName: 'Aspirin' }, { id: 0, medicineName: 'Ignored duplicate' }],
    [
      {
        slot: 0,
        name: 'vitamin a',
        doses: [{ time: '20:00 UTC', dose: 1 }, { time: '08:00 UTC', dose: 2 }],
        fallbackTime: '08:00',
      },
      { slot: 1, name: 'Ibuprofen', doses: [], fallbackTime: '09:30' },
    ],
  );
  assert.deepEqual(rows, [
    { slot: 0, label: 'Slot 1', name: 'Vitamin A', doseCount: 2, nextDose: '08:00 UTC', note: '' },
    {
      slot: 1,
      label: 'Slot 2',
      name: 'Aspirin',
      doseCount: 1,
      nextDose: '09:30',
      note: 'Server registry lists "Ibuprofen".',
    },
  ]);
});

test('flags slots that only one source knows about and keeps them in order', () => {
  const rows = buildMedicationRows(
    [{ id: 1, medicineName: 'Aspirin' }, { id: 0, medicineName: '   ' }],
    [{ slot: 0, name: 'Vitamin A', doses: [{ time: '08:00 UTC', dose: 1 }], fallbackTime: null }],
  );
  assert.deepEqual(rows, [
    { slot: 0, label: 'Slot 1', name: 'Vitamin A', doseCount: 1, nextDose: '08:00 UTC', note: 'Not on the dispenser.' },
    { slot: 1, label: 'Slot 2', name: 'Aspirin', doseCount: 0, nextDose: null, note: 'Not in the server registry.' },
  ]);
  assert.deepEqual(buildMedicationRows([], []), []);
});

test('spells out counts and rows for screen readers', () => {
  assert.equal(describeDoseCount(0), '—');
  assert.equal(describeDoseCount(1), '1 dose');
  assert.equal(describeDoseCount(4), '4 doses');
  assert.equal(
    describeMedicationRow({ slot: 1, label: 'Slot 2', name: 'Aspirin', doseCount: 2, nextDose: '09:30', note: '' }),
    'Slot 2: Aspirin, 2 doses, next dose 09:30.',
  );
  assert.equal(
    describeMedicationRow({
      slot: 0,
      label: 'Slot 1',
      name: 'Vitamin A',
      doseCount: 0,
      nextDose: null,
      note: 'Not on the dispenser.',
    }),
    'Slot 1: Vitamin A, —, no dose scheduled. Not on the dispenser.',
  );
});
