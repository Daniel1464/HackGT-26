import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { BleCounterStatus } from '@/lib/ble-counter';

export const StatusColors: Record<BleCounterStatus, string> = {
  idle: '#9CA3AF',
  scanning: '#F59E0B',
  connecting: '#F59E0B',
  connected: '#22C55E',
  error: '#EF4444',
  unsupported: '#9CA3AF',
};

export const StatusLabels: Record<BleCounterStatus, string> = {
  idle: 'Starting',
  scanning: 'Searching',
  connecting: 'Connecting',
  connected: 'Live',
  error: 'Offline',
  unsupported: 'Unavailable',
};

type ConnectionChipProps = {
  status: BleCounterStatus;
  style?: StyleProp<ViewStyle>;
};

/** Bluetooth link badge, shared by the front page and the settings screen. */
export function ConnectionChip({ status, style }: ConnectionChipProps) {
  return (
    <View style={[styles.chip, style]}>
      <View style={[styles.dot, { backgroundColor: StatusColors[status] }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {StatusLabels[status]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: Spacing.two,
    height: Spacing.two,
    borderRadius: Spacing.one,
  },
});
