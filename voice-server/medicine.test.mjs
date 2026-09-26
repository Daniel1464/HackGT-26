import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMedicineTranscript, validateMedicine, medicineWireJson, medicineDosePacket } from '../pill-dispenser-app/src/lib/medicine.ts';

test('spoken example preserves medicine and both doses with UTC conversion', () => {
  assert.deepEqual(parseMedicineTranscript('Medicine Vitamin A, ID zero, at eight AM UTC dose two and at eight PM UTC dose one.'), {
    medicine: 'Vitamin A', id: 0, data: [{ time: '08:00 UTC', dose: 2 }, { time: '20:00 UTC', dose: 1 }],
  });
});
test('midnight and noon remain distinct', () => {
  assert.deepEqual(parseMedicineTranscript('Medicine Test ID one at 12 AM UTC dose 1 and at 12 PM UTC dose 2').data.map(x => x.time), ['00:00 UTC', '12:00 UTC']);
});
test('rejects ambiguous and incomplete schedules', () => {
  for (const text of ['Take two tomorrow', 'Medicine A ID zero at eight dose two',
    'Medicine A ID two at eight AM UTC dose two', 'Medicine A ID zero at 25:00 UTC dose 2',
    'Medicine A ID zero at 08:70 UTC dose 2', 'Medicine A ID zero at 08:00 UTC dose 0']) {
    assert.throws(() => parseMedicineTranscript(text));
  }
  assert.throws(() => validateMedicine({ medicine: 'A', id: 0, data: [null] }));
});
test('ASCII wire JSON round trips Unicode and enforces maximum payload', () => {
  const record = { medicine: '维生素💊', id: 1, data: [{ time: '08:00 UTC', dose: 2 }] };
  const wire = medicineWireJson(record);
  assert.match(wire, /^[\x00-\x7f]+$/);
  assert.deepEqual(JSON.parse(wire), record);
  assert.throws(() => medicineWireJson({ ...record, medicine: 'A'.repeat(4096) }));
});
test('dose packets are exactly 7 bytes with little-endian fields', () => {
  const record = { medicine: 'Vitamin A', id: 1, data: [{ time: '08:30 UTC', dose: 300 }] };
  const bytes = new Uint8Array(medicineDosePacket(record, record.data[0]));
  assert.deepEqual([...bytes], [1, 0xfe, 0x01, 0x2c, 0x01, 0x00, 0x00]);
});
