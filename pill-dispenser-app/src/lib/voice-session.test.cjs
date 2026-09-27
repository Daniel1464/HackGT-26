const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'voice-session.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', compiled)(loaded.exports);
const { VoiceSessionLifecycle } = loaded.exports;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}) {
  const calls = [];
  const lifecycle = new VoiceSessionLifecycle({
    prepare: async () => { calls.push('prepare'); },
    release: async () => { calls.push('release'); },
    change: phase => calls.push(phase),
    error: message => calls.push(message),
    finished: () => calls.push('finished'), ...overrides,
  });
  return { lifecycle, calls };
}

test('two successive providers start with fresh audio; closing blocks repeated taps until teardown completes', async () => {
  for (let cycle = 0; cycle < 2; cycle++) {
    const end = deferred(); const release = deferred();
    const { lifecycle, calls } = harness({ release: () => release.promise });
    let starts = 0;
    const start = () => { starts++; lifecycle.created({ endSession: () => end.promise }); lifecycle.connected(); };
    await lifecycle.start(start);
    assert.equal(lifecycle.phase, 'connected');
    const closing = lifecycle.finish();
    assert.equal(lifecycle.finish(), closing);
    await lifecycle.start(start);
    assert.equal(starts, 1);
    end.resolve(); await Promise.resolve();
    assert.equal(calls.includes('finished'), false);
    release.resolve(); await closing;
    assert.equal(calls.at(-1), 'finished');
  }
});

test('microphone denial does not start the SDK and cleans up before offering a fresh provider', async () => {
  const { lifecycle, calls } = harness({ prepare: async () => { throw Error('Microphone denied'); } });
  await lifecycle.start(() => assert.fail('must not start'));
  assert.ok(calls.includes('Microphone denied'));
  assert.deepEqual(calls.slice(-2), ['release', 'finished']);
});

test('reentrant disconnect and network error close native audio exactly once', async () => {
  const { lifecycle, calls } = harness();
  let ends = 0;
  await lifecycle.start(() => {
    lifecycle.created({ endSession: async () => { ends++; void lifecycle.finish(); } });
    lifecycle.connected();
  });
  await lifecycle.fail('Network lost');
  assert.equal(ends, 1);
  assert.equal(calls.filter(call => call === 'release').length, 1);
  assert.equal(calls.filter(call => call === 'finished').length, 1);
});

test('unmount during permission request prevents startup and ignores stale connected callbacks', async () => {
  const permission = deferred();
  const { lifecycle, calls } = harness({ prepare: () => permission.promise });
  const starting = lifecycle.start(() => assert.fail('unmounted session started'));
  lifecycle.dispose(); permission.resolve(); await starting;
  await lifecycle.finish(); lifecycle.connected();
  assert.equal(calls.includes('connected'), false);
  assert.equal(calls.includes('finished'), false);
});

test('rapid start taps create one connection, including while microphone permission is pending', async () => {
  const permission = deferred();
  const { lifecycle } = harness({ prepare: () => permission.promise });
  let starts = 0;
  const first = lifecycle.start(() => starts++);
  await lifecycle.start(() => starts++);
  permission.resolve(); await first;
  assert.equal(starts, 1);
});

test('remote hangup cleans up, and a teardown rejection is surfaced without trapping the next provider', async () => {
  const { lifecycle, calls } = harness();
  await lifecycle.start(() => {
    lifecycle.created({ endSession: async () => { throw Error('Transport already closed'); } });
    lifecycle.connected();
  });
  await lifecycle.finish();
  assert.ok(calls.some(call => call.includes('Transport already closed')));
  assert.deepEqual(calls.slice(-2), ['release', 'finished']);
});
