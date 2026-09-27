const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');

// Compile only these pure helpers in memory; no React Native runtime or board needed.
function load(filename) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (name) => name === './medicine' ? load('medicine.ts') : require(name), module, module.exports,
  );
  return module.exports;
}
const { adaptMedicationSchedule, createMedicationClientTools } = load('medication-agent-tools.ts');
const medications = [{ medicine: 'Test medication', id: 1 }];
const input = { medicineName: ' test MEDICATION ', doses: [{ time: '08:30', quantity: 2 }] };

test('adapts dashboard parameters using canonical identity and local-to-UTC time', () => {
  const now = new Date(2026, 8, 26, 12);
  const expected = new Date(2026, 8, 26, 8, 30);
  const time = `${String(expected.getUTCHours()).padStart(2, '0')}:${String(expected.getUTCMinutes()).padStart(2, '0')} UTC`;
  assert.deepEqual(adaptMedicationSchedule(input, medications, now), {
    medicine: 'Test medication', id: 1, data: [{ time, dose: 2 }],
  });
});

test('rejects invalid inputs, unknown names, ambiguous identities and firmware overflow', () => {
  for (const value of [null, {}, { ...input, medicineName: ' ' }, { ...input, doses: [] },
    ...['8:00', '24:00', '12:60', '08:30 UTC'].map(time => ({ ...input, doses: [{ time, quantity: 2 }] })),
    ...[0, -1, 1.5, '2', 2147483648].map(quantity => ({ ...input, doses: [{ time: '08:30', quantity }] })),
    { ...input, doses: Array(33).fill(input.doses[0]) }]) {
    assert.throws(() => adaptMedicationSchedule(value, medications));
  }
  assert.throws(() => adaptMedicationSchedule(input, []), /resolve/);
  assert.throws(() => adaptMedicationSchedule(input, [...medications, ...medications]), /multiple configured IDs/);
});

test('save only reports success after BLE completes; failures stay structured', async () => {
  let release;
  let saved = false;
  const pending = new Promise(resolve => { release = resolve; });
  const options = { connected: true, medications,
    getMedicineIdForName: async () => 1, saveMedicineName: async () => {},
    getServerSchedules: async () => [], getServerHistory: async () => [],
    sendMedicine: () => pending,
    onSaved: () => { saved = true; }, onError: () => {} };
  const tools = createMedicationClientTools(options);
  const result = tools.saveMedicationSchedule(input);
  assert.equal(saved, false);
  release();
  assert.deepEqual(await result, { success: true, medicineName: 'Test medication' });
  assert.equal(saved, true);
  const failed = createMedicationClientTools({ ...options, sendMedicine: async () => { throw new Error('Disconnected'); } });
  assert.deepEqual(await failed.saveMedicationSchedule(input), { success: false, error: 'Disconnected' });
  assert.equal((await createMedicationClientTools({ ...options, connected: false }).saveMedicationSchedule(input)).success, false);
});

test('unresolved names never reach BLE; unavailable readers return failures instead of fabricated data', async () => {
  const tools = createMedicationClientTools({ connected: true, medications: [],
    getMedicineIdForName: async () => { throw new Error('Unknown medicine.'); },
    saveMedicineName: async () => {}, getServerSchedules: async () => [], getServerHistory: async () => [],
    sendMedicine: async () => assert.fail('Must not send'), onSaved: () => {}, onError: () => {} });
  assert.equal((await tools.saveMedicationSchedule(input)).success, false);
  assert.deepEqual(await tools.getMedicationSchedule(), { success: true, medications: [], history: [] });
});

test('remove validates the exact medicineID parameter and reports success only after deletion', async () => {
  let removed;
  const tools = createMedicationClientTools({ connected: true, medications,
    getMedicineIdForName: async () => 0, saveMedicineName: async () => {},
    getServerSchedules: async () => [], getServerHistory: async () => [],
    sendMedicine: async () => {},
    removeMedicineSchedule: async (medicineID) => { removed = medicineID; }, onSaved: () => {}, onError: () => {} });
  assert.equal((await tools.removeMedicineSchedule({ medicineID: 2 })).success, false);
  assert.equal(removed, undefined);
  assert.deepEqual(await tools.removeMedicineSchedule({ medicineID: 0 }), {
    success: true, medicineId: 0, message: 'Medication schedule removed successfully.',
  });
  assert.equal(removed, 0);
});
