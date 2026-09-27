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
  ORB_ACTIONS,
  ORB_HINTS,
  ORB_PALETTES,
  orbConnectionFor,
  orbTapFor,
  resolveOrbState,
} = load('voice-orb.ts');

const ORB_STATES = ['idle', 'connecting', 'listening', 'speaking', 'linking', 'offline'];

test('reads the Bluetooth status as an orb connection', () => {
  assert.equal(orbConnectionFor('connected'), 'connected');
  assert.equal(orbConnectionFor('idle'), 'pending');
  assert.equal(orbConnectionFor('scanning'), 'pending');
  assert.equal(orbConnectionFor('connecting'), 'pending');
  assert.equal(orbConnectionFor('error'), 'unavailable');
  assert.equal(orbConnectionFor('unsupported'), 'unavailable');
});

test('a live conversation outranks a dropped dispenser', () => {
  assert.equal(resolveOrbState('connected', false, 'connected'), 'listening');
  assert.equal(resolveOrbState('connected', true, 'connected'), 'speaking');
  assert.equal(resolveOrbState('connected', true, 'unavailable'), 'speaking');
  assert.equal(resolveOrbState('connecting', false, 'connected'), 'connecting');
  assert.equal(resolveOrbState('disconnected', false, 'pending'), 'linking');
  assert.equal(resolveOrbState('disconnected', false, 'unavailable'), 'offline');
  assert.equal(resolveOrbState('disconnected', false, 'connected'), 'idle');
});

test('every orb state maps to a single tap action', () => {
  assert.equal(orbTapFor('idle', 'connected'), 'start');
  assert.equal(orbTapFor('idle', 'pending'), 'none');
  assert.equal(orbTapFor('connecting', 'connected'), 'none');
  assert.equal(orbTapFor('linking', 'pending'), 'none');
  assert.equal(orbTapFor('listening', 'connected'), 'end');
  assert.equal(orbTapFor('speaking', 'connected'), 'end');
  assert.equal(orbTapFor('offline', 'unavailable'), 'retry');
});

test('every orb state is themed and described for screen readers', () => {
  for (const state of ORB_STATES) {
    assert.match(ORB_HINTS[state], /\S/);
    assert.match(ORB_ACTIONS[state], /\S/);
    const palette = ORB_PALETTES[state];
    for (const color of [palette.core[0], palette.core[1], palette.glow, palette.ring, palette.node]) {
      assert.match(color, /^#[0-9A-F]{6}$/i);
    }
  }
});
