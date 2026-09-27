import { AudioModule } from 'expo-audio';
import { AudioSession } from '@livekit/react-native';

export async function prepareVoiceAudio() {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error('Microphone permission is required to talk to the assistant.');
  // Failed SDK connection setup can leave the native session active without a cleanup handle.
  await AudioSession.stopAudioSession();
  // ElevenLabs configures and starts the next audio session itself.
}

export async function releaseVoiceAudio() {
  await AudioSession.stopAudioSession();
}
