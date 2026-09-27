import { StyleSheet, View } from 'react-native';
import { useCallback, useState } from 'react';
import { ConversationProvider } from '@elevenlabs/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionChip } from '@/components/connection-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VoiceOrb } from '@/components/voice-orb';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDispenser } from '@/hooks/use-dispenser';
import { useMedicationConversation } from '@/hooks/use-medication-conversation';
import { orbConnectionFor, orbTapFor, resolveOrbState } from '@/lib/voice-orb';

export default function HomeScreen() {
  const [sessionKey, setSessionKey] = useState(0);
  const [previousError, setPreviousError] = useState<string>();
  const resetSession = useCallback((error?: string) => {
    setPreviousError(error);
    setSessionKey(key => key + 1);
  }, []);
  // Reset only voice state, never the shared BLE connection or navigation tree.
  return <ConversationProvider key={sessionKey}>
    <VoiceHome onFinished={resetSession} previousError={previousError} />
  </ConversationProvider>;
}

function VoiceHome({ onFinished, previousError }: { onFinished: (error?: string) => void; previousError?: string }) {
  const dispenser = useDispenser();
  const conversation = useMedicationConversation(dispenser, onFinished, previousError);

  const connection = orbConnectionFor(dispenser.status);
  const state = resolveOrbState(conversation.status, conversation.isSpeaking, connection);
  const tap = orbTapFor(state, connection);

  const onOrbPress = () => {
    if (tap === 'retry') {
      dispenser.retry();
      return;
    }
    if (tap === 'start' || tap === 'end') {
      conversation.toggle();
    }
  };

  const hasTranscript = Boolean(conversation.message || conversation.saved || conversation.error);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.intro}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Pill dispenser
            </ThemedText>
            <ConnectionChip status={dispenser.status} />
          </View>
          <ThemedText type="title">Talk to your dispenser</ThemedText>
          <ThemedText themeColor="textSecondary">
            Say what to take and when. The assistant checks every dose before the dispenser locks it in.
          </ThemedText>
        </View>

        <View style={styles.stage}>
          <VoiceOrb disabled={tap === 'none' || conversation.busy} onPress={onOrbPress} state={state} />
          {conversation.busy && <ThemedText accessibilityLiveRegion="polite">Closing microphone…</ThemedText>}
        </View>

        {hasTranscript && (
          <ThemedView type="backgroundElement" style={styles.transcript}>
            {conversation.message ? (
              <ThemedText numberOfLines={3} type="small">
                {conversation.message}
              </ThemedText>
            ) : null}
            {conversation.saved ? (
              <ThemedText type="small" themeColor="textSecondary">
                {conversation.saved}
              </ThemedText>
            ) : null}
            {conversation.error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {conversation.error}
              </ThemedText>
            ) : null}
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset,
  },
  intro: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 120,
  },
  transcript: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
});
