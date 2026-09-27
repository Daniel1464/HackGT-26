const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('repeated sessions leave native audio ownership exclusively with ElevenLabs', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'voice-audio.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  let permissionChecks = 0;
  new Function('require', 'exports', outputText)(name => {
    assert.equal(name, 'expo-audio', 'Only microphone authorization is queried here');
    return { AudioModule: { requestRecordingPermissionsAsync: async () => {
      permissionChecks++;
      return { granted: true };
    } } };
  }, module.exports);
  for (let i = 0; i < 3; i++) {
    await module.exports.prepareVoiceAudio();
    await module.exports.releaseVoiceAudio();
  }
  assert.equal(permissionChecks, 3);
});
