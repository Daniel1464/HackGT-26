import { useState } from 'react';
import { useConversation } from '@elevenlabs/react-native';

import type { UseBleCounterResult } from '@/lib/ble-counter';
import { createMedicationClientTools } from '@/lib/medication-agent-tools';
import { getServerMedicationHistory, getServerMedicationSchedules } from '@/lib/medicine-api';

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
export function useMedicationConversation(dispenser: UseBleCounterResult): MedicationConversation {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);

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
    clientTools: {
      // This SDK version accepts strings; preserve the structured result as JSON.
      saveMedicationSchedule: async (parameters) => JSON.stringify(await tools.saveMedicationSchedule(parameters)),
      getMedicationSchedule: async () => JSON.stringify(await tools.getMedicationSchedule()),
      removeMedicineSchedule: async (parameters) => JSON.stringify(await tools.removeMedicineSchedule(parameters)),
    },
    onError: (message) => {
      setIsEnding(false);
      setError(String(message));
    },
    onDisconnect: () => setIsEnding(false),
  });

  const active = conversation.status === 'connected' || conversation.status === 'connecting';
  const toggle = () => {
    if (isEnding) return;
    if (active) {
      setIsEnding(true);
      conversation.endSession();
      return;
    }
    setError(null);
    setSaved(null);
    conversation.startSession({ agentId: AGENT_ID });
  };

  return {
    status: String(conversation.status),
    isSpeaking: Boolean(conversation.isSpeaking),
    message: conversation.message ?? '',
    busy: isEnding,
    saved,
    error,
    toggle,
  };
}
