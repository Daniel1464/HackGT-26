import { AudioModule } from 'expo-audio';

export async function prepareVoiceAudio() {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error('Microphone permission is required to talk to the assistant.');
  // ElevenLabs owns configure/start/stop. Extra stop calls change the shared
  // RTCAudioSession activation count and can disable capture in the next call.
}

export async function releaseVoiceAudio() {
  // The awaited SDK endSession() already stops native audio. Do not stop twice.
}
