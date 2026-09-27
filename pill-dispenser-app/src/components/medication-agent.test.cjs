const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function harness() {
  let options;
  let starts = 0;
  let providers = 0;
  let automaticConnection = true;
  let rejectPermission = false;
  const endings = [];
  const releases = [];
  const sdk = {
    ConversationProvider: ({ children }) => {
      React.useEffect(() => { providers++; }, []);
      return children;
    },
    useConversation: current => {
      options = current;
      return { status: 'disconnected', isSpeaking: false,
        startSession: () => {
          starts++;
          if (!automaticConnection) return;
          const callbacks = current;
          const ending = deferred(); endings.push(ending);
          current.onConversationCreated({ endSession: async () => {
            await ending.promise;
            callbacks.onStatusChange({ status: 'disconnected' });
            callbacks.onDisconnect();
          } });
          current.onConnect();
        },
        endSession: () => current.onStatusChange({ status: 'disconnected' }),
      };
    },
  };
  const source = fs.readFileSync(path.join(__dirname, 'medication-agent.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name === 'react-native') return { AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: 'Spinner', Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value } };
    if (name === '@elevenlabs/react-native') return sdk;
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/lib/medication-agent-tools') return { createMedicationClientTools: () => ({}) };
    if (name === '@/lib/voice-audio') return {
      prepareVoiceAudio: async () => { if (rejectPermission) throw new Error('Microphone denied'); },
      releaseVoiceAudio: () => { const release = deferred(); releases.push(release); return release.promise; },
    };
    return require(name);
  }, module, module.exports);
  return { Component: module.exports.MedicationAgent, endings, releases,
    get starts() { return starts; }, get providers() { return providers; }, get options() { return options; },
    set automaticConnection(value) { automaticConnection = value; },
    set rejectPermission(value) { rejectPermission = value; } };
}

const props = { connected: false, sendMedicine: async () => {}, getMedicineIdForName: async () => 0,
  saveMedicineName: async () => {}, removeMedicineSchedule: async () => {},
  getServerSchedules: async () => [], getServerHistory: async () => [] };

test('voice can be used twice; restart stays locked until actual teardown and audio release finish', async () => {
  const h = harness();
  let root;
  await Renderer.act(async () => { root = Renderer.create(React.createElement(h.Component, props)); });
  const button = () => root.root.findByType('Pressable');
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal(button().props.accessibilityLabel, 'Talk to TiMED');
    // History questions are available even when Bluetooth is disconnected.
    assert.equal(button().props.disabled, false);
    await Renderer.act(async () => { button().props.onPress(); });
    assert.equal(h.starts, cycle + 1);
    assert.equal(button().props.accessibilityLabel, 'End conversation');
    await Renderer.act(async () => { button().props.onPress(); });
    assert.equal(button().props.disabled, true);
    assert.equal(h.providers, cycle + 1);
    await Renderer.act(async () => { h.endings[cycle].resolve(); });
    assert.equal(button().props.disabled, true);
    assert.equal(h.releases.length, cycle + 1);
    await Renderer.act(async () => { h.releases[cycle].resolve(); });
    assert.equal(h.providers, cycle + 2);
  }
  await Renderer.act(async () => root.unmount());
});

test('connection failure and microphone denial leave the voice button retryable', async () => {
  const h = harness(); h.automaticConnection = false;
  let root;
  await Renderer.act(async () => { root = Renderer.create(React.createElement(h.Component, props)); });
  await Renderer.act(async () => root.root.findByType('Pressable').props.onPress());
  await Renderer.act(async () => h.options.onError('Network unavailable'));
  await Renderer.act(async () => h.releases[0].resolve());
  assert.equal(root.root.findByType('Pressable').props.accessibilityLabel, 'Talk to TiMED');
  h.rejectPermission = true;
  await Renderer.act(async () => root.root.findByType('Pressable').props.onPress());
  await Renderer.act(async () => h.releases[1].resolve());
  assert.equal(root.root.findByType('Pressable').props.disabled, false);
  assert.equal(h.starts, 1);
  await Renderer.act(async () => root.unmount());
});
