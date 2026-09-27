import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ConnectionChip } from '@/components/connection-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDispenser } from '@/hooks/use-dispenser';
import { useTheme } from '@/hooks/use-theme';
import { fetchRegisteredMedicines } from '@/lib/medicine-api';
import {
  buildMedicationRows,
  describeDoseCount,
  describeMedicationRow,
  type DispenserSlot,
  type RegisteredMedicine,
} from '@/lib/medication-table';

/**
 * Table of the currently registered medications, for people who can read.
 *
 * Rows merge what the dispenser holds with the server registry, so a slot that
 * only one of the two knows about is still visible and labelled as such. Both
 * sources are read when the tab is focused, which keeps the single Bluetooth
 * link free while someone is talking to the assistant on the home page.
 */
export default function MedicationsScreen() {
  const theme = useTheme();
  const { status, getMedicationNames } = useDispenser();
  const [registry, setRegistry] = useState<RegisteredMedicine[]>([]);
  const [slots, setSlots] = useState<DispenserSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRegistry(await fetchRegisteredMedicines());
    } catch (loadError) {
      setRegistry([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load();
      if (status !== 'connected') {
        setSlots([]);
        return () => {
          cancelled = true;
        };
      }
      void getMedicationNames()
        .then((names) => {
          if (!cancelled) setSlots(names);
        })
        .catch(() => {
          if (!cancelled) setSlots([]);
        });
      return () => {
        cancelled = true;
      };
    }, [load, status, getMedicationNames]),
  );

  const rows = useMemo(() => buildMedicationRows(slots, registry), [slots, registry]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    if (status === 'connected') {
      try {
        setSlots(await getMedicationNames());
      } catch {
        setSlots([]);
      }
    }
    setRefreshing(false);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="subtitle">Medications</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Everything the dispenser and the server have registered.
            </ThemedText>
          </View>
          <ConnectionChip status={status} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} />
          }>
          {loading && <ActivityIndicator />}

          {error !== null && (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="smallBold">Server registry unavailable</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            </ThemedView>
          )}

          {!loading && rows.length === 0 && (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="smallBold">No medication registered yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Ask the assistant on the home page for a schedule, then pull down to refresh this table.
              </ThemedText>
            </ThemedView>
          )}

          {rows.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.table}>
              <View style={[styles.row, styles.headRow]}>
                <ThemedText type="smallBold" style={styles.slotCell}>
                  Slot
                </ThemedText>
                <ThemedText type="smallBold" style={styles.headNameCell}>
                  Medication
                </ThemedText>
                <ThemedText type="smallBold" style={styles.doseCell}>
                  Doses
                </ThemedText>
                <ThemedText type="smallBold" style={styles.timeCell}>
                  Next
                </ThemedText>
              </View>

              {rows.map((row, index) => (
                <View
                  accessible
                  accessibilityLabel={describeMedicationRow(row)}
                  key={row.slot}
                  style={[
                    styles.row,
                    index < rows.length - 1 && {
                      borderBottomColor: theme.backgroundSelected,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.slotCell}>
                    {row.label}
                  </ThemedText>
                  <View style={styles.nameCell}>
                    <ThemedText type="small" numberOfLines={1}>
                      {row.name}
                    </ThemedText>
                    {row.note !== '' && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {row.note}
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText type="small" style={styles.doseCell}>
                    {describeDoseCount(row.doseCount)}
                  </ThemedText>
                  <ThemedText type="small" style={styles.timeCell}>
                    {row.nextDose ?? '—'}
                  </ThemedText>
                </View>
              ))}
            </ThemedView>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={({ pressed }) => [
              styles.refreshButton,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">{refreshing ? 'Refreshing…' : 'Refresh'}</ThemedText>
          </Pressable>

          <ThemedText type="small" themeColor="textSecondary">
            The name the dispenser holds wins over the server registry. Dose times are stored in UTC.
          </ThemedText>
        </ScrollView>
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
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.one,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  table: {
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  headRow: {
    paddingVertical: Spacing.two,
  },
  slotCell: {
    width: 56,
  },
  headNameCell: {
    flex: 1,
  },
  nameCell: {
    flex: 1,
    gap: Spacing.one,
  },
  doseCell: {
    width: 64,
    textAlign: 'right',
  },
  timeCell: {
    width: 76,
    textAlign: 'right',
  },
  notice: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
