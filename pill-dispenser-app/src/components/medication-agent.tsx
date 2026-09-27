import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConversation } from '@elevenlabs/react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { type MedicineRecord } from '@/lib/medicine';
import { createMedicationClientTools } from '@/lib/medication-agent-tools';

const AGENT_ID = 'agent_9101m3e5mt3ne7xv0mnaxm23dwwe';

type MedicationAgentProps = {
  connected: boolean;
  sendMedicine: (record: MedicineRecord) => Promise<void>;
  getMedicineIdForName: (medicineName: string) => Promise<0 | 1>;
  saveMedicineName: (medicineID: 0 | 1, medicineName: string) => Promise<void>;
  removeMedicineSchedule: (medicineID: number) => Promise<void>;
  getServerSchedules: () => Promise<Array<{ id: 0 | 1; medicine: string; data?: Array<{ time: string; dose: number }> }>>;
  getServerHistory: () => Promise<Array<{ event_id: number; medicine_id: 0 | 1; medicine_name: string; scheduled_for: string; quantity: number; status: 'upcoming' | 'late' | 'missed' | 'taken' | 'cancelled'; taken: boolean; taken_at: string | null }>>;
};

/** Live ElevenLabs conversation using the dashboard's case-sensitive tool names. */
export function MedicationAgent({ connected, sendMedicine, getMedicineIdForName, saveMedicineName, removeMedicineSchedule, getServerSchedules, getServerHistory }: MedicationAgentProps) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const tools = createMedicationClientTools({
    connected,
    getMedicineIdForName,
    saveMedicineName,
    sendMedicine,
    removeMedicineSchedule,
    getServerSchedules,
    getServerHistory,
    onSaved: (medicineName) => {
      setError(null);
      setSaved(`${medicineName} schedule sent to dispenser.`);
    },
    onError: (message) => { setSaved(null); setError(message); },
  });
  const conversation = useConversation({
    clientTools: {
      // This SDK version accepts strings; preserve the structured result as JSON.
      saveMedicationSchedule: async (parameters) => JSON.stringify(await tools.saveMedicationSchedule(parameters)),
      getMedicationSchedule: async () => JSON.stringify(await tools.getMedicationSchedule()),
      getPrevMedicationStatus: async () => JSON.stringify(await tools.getPrevMedicationStatus()),
      removeMedicineSchedule: async (parameters) => JSON.stringify(await tools.removeMedicineSchedule(parameters)),
    },
    onError: (message) => {
      setIsEnding(false);
      setError(String(message));
    },
    onDisconnect: () => setIsEnding(false),
  });

  const active = conversation.status === 'connected' || conversation.status === 'connecting';
  const start = () => {
    if (isEnding) return;
    setError(null);
    setSaved(null);
    conversation.startSession({ agentId: AGENT_ID });
  };
  const end = () => {
    if (isEnding) return;
    setIsEnding(true);
    conversation.endSession();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Medication Assistant</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {conversation.status === 'connected' ? (conversation.isSpeaking ? 'Speaking' : 'Listening') : conversation.status}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Ask the assistant to schedule a medicine. It will send the validated schedule to the dispenser.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={isEnding || conversation.status === 'connecting' || (!connected && !active)}
        onPress={active ? end : start}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, !connected && styles.disabled]}>
        <ThemedText type="smallBold">{isEnding ? 'Ending…' : active ? 'End conversation' : 'Talk to assistant'}</ThemedText>
      </Pressable>
      {conversation.message && <ThemedText type="small">{conversation.message}</ThemedText>}
      {saved && <ThemedText type="small" themeColor="textSecondary">{saved}</ThemedText>}
      {error && <ThemedText type="small" themeColor="textSecondary">{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, paddingTop: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five, backgroundColor: '#A7D8FF' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
