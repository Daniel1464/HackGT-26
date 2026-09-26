import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBleCounter } from '@/hooks/use-ble-counter';
import { useTheme } from '@/hooks/use-theme';
import {
  isValidServoValue,
  MAX_SERVO_VALUE,
  MIN_SERVO_VALUE,
  type BleCounterStatus,
} from '@/lib/ble-counter';

const StatusColors: Record<BleCounterStatus, string> = {
  idle: '#9CA3AF',
  scanning: '#F59E0B',
  connecting: '#F59E0B',
  connected: '#22C55E',
  error: '#EF4444',
  unsupported: '#9CA3AF',
};

const StatusLabels: Record<BleCounterStatus, string> = {
  idle: 'Starting',
  scanning: 'Searching',
  connecting: 'Connecting',
  connected: 'Live',
  error: 'Offline',
  unsupported: 'Unavailable',
};

/** Sends a servo angle to the ESP32 pill dispenser over Bluetooth Low Energy. */
export function ServoWidget() {
  const theme = useTheme();
  const { status, servoValue, deviceName, error, sendServoValue, retry } = useBleCounter();
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const isConnected = status === 'connected';

  let detail: string;
  switch (status) {
    case 'idle':
      detail = 'Starting Bluetooth…';
      break;
    case 'scanning':
      detail = 'Looking for the ESP32 pill dispenser…';
      break;
    case 'connecting':
      detail = `Connecting to ${deviceName ?? 'the pill dispenser'}…`;
      break;
    case 'connected':
      detail = servoValue === null
        ? `Connected to ${deviceName ?? 'the pill dispenser'}`
        : `Servo at ${servoValue}° on ${deviceName ?? 'the pill dispenser'}`;
      break;
    case 'error':
      detail = error ?? 'Something went wrong.';
      break;
    case 'unsupported':
      detail = error ?? 'Bluetooth is not available here.';
      break;
  }

  const send = async () => {
    const text = draft.trim();
    const value = Number(text);
    if (text === '' || !isValidServoValue(value)) {
      setFeedback(`Enter a whole number from ${MIN_SERVO_VALUE} to ${MAX_SERVO_VALUE}.`);
      return;
    }

    setFeedback(null);
    setIsSending(true);
    try {
      await sendServoValue(value);
      setFeedback(`Sent ${value}°`);
    } catch (sendError) {
      setFeedback(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Servo</ThemedText>
        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: StatusColors[status] }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {StatusLabels[status]}
          </ThemedText>
        </View>
      </View>

      <View style={styles.controls}>
        <TextInput
          accessibilityLabel="Servo angle in degrees"
          editable={isConnected && !isSending}
          inputMode="numeric"
          keyboardType="number-pad"
          onChangeText={setDraft}
          onSubmitEditing={() => {
            void send();
          }}
          placeholder={`${MIN_SERVO_VALUE}-${MAX_SERVO_VALUE}`}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="send"
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
              color: theme.text,
            },
          ]}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!isConnected || isSending}
          onPress={() => {
            void send();
          }}
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: theme.backgroundSelected },
            (!isConnected || isSending) && styles.disabled,
            pressed && styles.pressed,
          ]}>
          {isSending ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : (
            <ThemedText type="smallBold">Send</ThemedText>
          )}
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>

      {feedback !== null && (
        <ThemedText type="small" themeColor="textSecondary">
          {feedback}
        </ThemedText>
      )}

      {status === 'error' && (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Search again</ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statusDot: {
    width: Spacing.two,
    height: Spacing.two,
    borderRadius: Spacing.one,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sendButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 72,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
  },
  disabled: {
    opacity: 0.5,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
