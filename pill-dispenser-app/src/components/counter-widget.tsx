import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBleCounter } from '@/hooks/use-ble-counter';
import { useTheme } from '@/hooks/use-theme';
import type { BleCounterStatus } from '@/lib/ble-counter';

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

/** Counts the pills the ESP32 has dispensed, read over Bluetooth Low Energy. */
export function CounterWidget() {
  const theme = useTheme();
  const { status, counter, deviceName, error, retry } = useBleCounter();

  const isStarting = status === 'idle' || status === 'scanning' || status === 'connecting';

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
      detail = counter === null
        ? 'Waiting for the first reading…'
        : `Receiving from ${deviceName ?? 'the pill dispenser'}`;
      break;
    case 'error':
      detail = error ?? 'Something went wrong.';
      break;
    case 'unsupported':
      detail = error ?? 'Bluetooth is not available here.';
      break;
  }

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Counter</ThemedText>
        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: StatusColors[status] }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {StatusLabels[status]}
          </ThemedText>
        </View>
      </View>

      <View style={styles.valueContainer}>
        {counter !== null ? (
          <ThemedText type="title" style={styles.value}>
            {counter}
          </ThemedText>
        ) : isStarting ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : (
          <ThemedText type="title" themeColor="textSecondary" style={styles.value}>
            —
          </ThemedText>
        )}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>

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
  valueContainer: {
    minHeight: 52,
    justifyContent: 'center',
  },
  value: {
    fontVariant: ['tabular-nums'],
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
