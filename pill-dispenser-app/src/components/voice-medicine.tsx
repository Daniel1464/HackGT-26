import { useState } from 'react';
import { Button, Platform, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { ThemedText } from './themed-text';
import { useTheme } from '@/hooks/use-theme';
import { parseMedicineTranscript, validateMedicine, type MedicineRecord } from '@/lib/medicine';

export function VoiceMedicine({ connected, sendMedicine }: {
  connected: boolean; sendMedicine: (record: MedicineRecord) => Promise<void>;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [json, setJson] = useState('');
  const [message, setMessage] = useState('');
  // Intentionally bundled for the demo; this is not a server-side secret.
  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim();
  const inputStyle = { color: theme.text, borderColor: theme.textSecondary,
    borderWidth: 1, borderRadius: 8, padding: 10 };
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }
  async function toggleRecording() {
    if (!recording.isRecording) {
      if (Platform.OS === 'web') throw new Error('Voice transfer currently requires the iOS or Android app.');
      if (!apiKey) throw new Error('Set EXPO_PUBLIC_ELEVENLABS_API_KEY in .env.local and restart Expo.');
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required.');
      setJson(''); setTranscript('');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 60 });
      return;
    }
    await recorder.stop();
    await transcribe();
  }
  async function transcribe() {
    if (!recorder.uri) throw new Error('Record a message first.');
    if (!apiKey) throw new Error('Set EXPO_PUBLIC_ELEVENLABS_API_KEY in .env.local and restart Expo.');
    setJson('');
    const form = new FormData();
    // React Native uploads a local file URI directly as multipart form data.
    // DOM typings do not include React Native's supported file descriptor.
    form.append('file', { uri: recorder.uri, name: 'recording.m4a', type: 'audio/mp4' } as unknown as Blob);
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'eng');
    form.append('tag_audio_events', 'false');
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': apiKey },
      body: form, signal: AbortSignal.timeout(70000),
    });
    if (!response.ok) throw new Error(`ElevenLabs transcription failed (${response.status}). Check the API key and available credits.`);
    const result = await response.json();
    if (typeof result.text !== 'string') throw new Error('ElevenLabs returned no transcript.');
    setTranscript(result.text);
    setJson(JSON.stringify(parseMedicineTranscript(result.text), null, 2));
    setMessage('Review the medicine, ID, UTC times and doses before sending.');
  }
  return <View style={{ gap: 10 }}>
    <ThemedText type="smallBold">Voice medicine schedule</ThemedText>
    <ThemedText type="small">Say: Medicine Vitamin A, ID zero, at eight AM UTC dose two and at eight PM UTC dose one.</ThemedText>
    <Button disabled={busy} title={recording.isRecording ? 'Stop and transcribe' : 'Record (up to 60 seconds)'} onPress={() => void run(toggleRecording)} />
    {!recording.isRecording && recorder.uri && <Button disabled={busy} title="Transcribe last recording" onPress={() => void run(transcribe)} />}
    <TextInput accessibilityLabel="Transcript" style={inputStyle} multiline value={transcript} onChangeText={(value) => { setTranscript(value); setJson(''); }} placeholder="Transcript appears here" />
    <Button disabled={busy || !transcript || recording.isRecording} title="Build JSON from transcript" onPress={() => void run(async () => setJson(JSON.stringify(parseMedicineTranscript(transcript), null, 2)))} />
    {!!json && <TextInput accessibilityLabel="Medicine JSON for review" style={inputStyle} multiline value={json} onChangeText={setJson} />}
    <Button disabled={busy || !connected || !json || recording.isRecording} title="Confirm and save to dispenser" onPress={() => void run(async () => {
      await sendMedicine(validateMedicine(JSON.parse(json)));
      setMessage('Dispenser confirmed the medicine schedule was saved.');
    })} />
    {!!message && <ThemedText type="small">{message}</ThemedText>}
  </View>;
}
