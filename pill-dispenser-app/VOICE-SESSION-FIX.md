# Repeated voice sessions

The installed ElevenLabs 1.2.27 SDK declares `@livekit/react-native ^2.12.0` as a
peer dependency. The app previously used 3.0.0. The dependency and lockfile now
use exactly 2.12.0, paired with exactly `@livekit/react-native-webrtc 144.1.2`.
WebRTC 144.2.0 renames the iOS framework to `LiveKitWebRTC`, whereas LiveKit
2.12.0 still imports `WebRTC/WebRTC.h`. Do not upgrade only one of this pair.
This is a native dependency change: rebuild and reinstall the native
app using your existing development/EAS build workflow; a Metro reload alone
does not replace the installed native library.

The SDK hook's `endSession()` returns void and starts teardown asynchronously.
The app now retains the actual conversation from `onConversationCreated`, awaits
its `endSession()` promise (which releases native audio), then remounts only the voice
provider. The dispenser provider remains mounted. Repeated taps cannot overlap
startup/teardown, and permission or connection failures leave a fresh retry path.

The app must not call `AudioSession.stopAudioSession()` before starting or after
SDK teardown: the SDK owns the paired native start/stop calls. Extra deactivation
can interfere with the iOS shared audio session. This ownership is enforced by
`src/lib/voice-audio.ts`. LiveKit's Expo initialization
plugins are now registered; installing those requires a new native build.
Voice startup is independent of Bluetooth; write tools still enforce BLE connectivity.

LiveKit's `WS closed unexpectedly with code 1001` is a signaling disconnect,
not proof of a microphone failure or invalid API key. A terminal SDK disconnect
now follows the same cleanup path. Network/server outages can still happen;
this change does not suppress them or replay medication tool calls.

## Phone verification (required)

1. Rebuild/reinstall the native app, then start Metro with a cleared cache
   (`pnpm exec expo start --clear`).
2. Tap the orb, ask a read-only schedule question, and confirm both microphone
   input and assistant audio work.
3. End the conversation. Wait for “Closing microphone…” to disappear.
4. Repeat three times. Also test rapid taps and a network disconnect/reconnect.
5. Confirm Bluetooth stays connected through voice resets.

Automated lifecycle tests: `node --test src/lib/voice-session.test.cjs`.
These mock asynchronous teardown; they do not replace a real-device audio test.
