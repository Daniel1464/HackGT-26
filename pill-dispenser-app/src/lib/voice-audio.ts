import { AudioModule } from 'expo-audio';

export async function prepareVoiceAudio() {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error('Microphone permission is required to talk to the assistant.');
  // ElevenLabs' React Native transport configures and owns the WebRTC audio session.
  // Stopping AudioSession here deactivates the shared RTCAudioSession immediately
  // before WebRTC starts capturing. It is stopped once by SDK endSession() below.
}

// VoiceConversation.endSession() awaits its native audio cleanup. A second stop
// can deactivate iOS capture for the following call, so there is nothing to do here.
export async function releaseVoiceAudio() {}
