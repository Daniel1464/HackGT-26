import { useEffect, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react-native';

import type { UseBleCounterResult } from '@/lib/ble-counter';
import { createMedicationClientTools } from '@/lib/medication-agent-tools';
import { getServerMedicationHistory, getServerMedicationSchedules } from '@/lib/medicine-api';
import { prepareVoiceAudio, releaseVoiceAudio } from '@/lib/voice-audio';
import { VoiceSessionLifecycle, type VoicePhase } from '@/lib/voice-session';

const AGENT_ID = 'agent_9101m3e5mt3ne7xv0mnaxm23dwwe';

export type MedicationConversation = {
  /** ElevenLabs conversation status, e.g. `disconnected`, `connecting`, `connected`. */
  status: string;
  isSpeaking: boolean;
  /** What the agent said last. */
  message: string;
  /** True while the session is being torn down. */
  busy: boolean;
  saved: string | null;
  error: string | null;
  /** Starts a session, or ends the running one. */
  toggle: () => void;
};

/**
 * The live ElevenLabs conversation, wired to the dispenser over Bluetooth.
 *
 * Lives in a hook so the front page only has to render: the orb reads `status`
 * and `isSpeaking`, and the transcript reads `message`, `saved` and `error`.
 */
export function useMedicationConversation(dispenser: UseBleCounterResult, onFinished: (error?: string) => void, previousError?: string): MedicationConversation {
  const [error, setError] = useState<string | null>(previousError ?? null);
  const [saved, setSaved] = useState<string | null>(null);
  const [phase, setPhase] = useState<VoicePhase>('disconnected');
  const [lifecycle] = useState(() => new VoiceSessionLifecycle({
    prepare: prepareVoiceAudio, release: releaseVoiceAudio,
    change: setPhase, error: setError, finished: onFinished,
  }));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React Strict Mode replays effects; only close on a real unmount.
      queueMicrotask(() => { if (!mounted.current) lifecycle.dispose(); });
    };
  }, [lifecycle]);

  const connected = dispenser.status === 'connected';
  const tools = createMedicationClientTools({
    connected,
    getMedicineIdForName: dispenser.getMedicineIdForName,
    saveMedicineName: dispenser.saveMedicineName,
    sendMedicine: dispenser.sendMedicine,
    removeMedicineSchedule: dispenser.removeMedicineSchedule,
    getServerSchedules: getServerMedicationSchedules,
    getServerHistory: getServerMedicationHistory,
    onSaved: (medicineName) => {
      setError(null);
      setSaved(`${medicineName} schedule sent to dispenser.`);
    },
    onError: (message) => {
      setSaved(null);
      setError(message);
    },
  });

  const conversation = useConversation({
    micMuted: false,
    clientTools: {
      // This SDK version accepts strings; preserve the structured result as JSON.
      saveMedicationSchedule: async (parameters) => JSON.stringify(await tools.saveMedicationSchedule(parameters)),
      getMedicationSchedule: async () => JSON.stringify(await tools.getMedicationSchedule()),
      removeMedicineSchedule: async (parameters) => JSON.stringify(await tools.removeMedicineSchedule(parameters)),
    },
    onConversationCreated: (session) => lifecycle.created(session),
    onConnect: () => lifecycle.connected(),
    onError: (message) => { void lifecycle.fail(message); },
    onDisconnect: (details) => {
      // A failed signaling connection may arrive only as onDisconnect, not onError.
      if (details.reason === 'error') {
        void lifecycle.fail('Voice connection lost. Tap the orb to reconnect.');
      } else {
        void lifecycle.finish();
      }
    },
  });

  const toggle = () => {
    if (lifecycle.phase === 'connecting' || lifecycle.phase === 'disconnecting') return;
    if (lifecycle.phase === 'connected') {
      void lifecycle.finish();
      return;
    }
    setError(null);
    setSaved(null);
    void lifecycle.start(() => conversation.startSession({ agentId: AGENT_ID, connectionType: 'webrtc' }));
  };

  return {
    status: phase,
    isSpeaking: Boolean(conversation.isSpeaking),
    message: conversation.message ?? '',
    busy: phase === 'disconnecting',
    saved,
    error,
    toggle,
  };
}
