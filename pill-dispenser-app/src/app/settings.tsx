import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionChip } from '@/components/connection-chip';
import { ServoWidget } from '@/components/servo-widget';
import { SocialAccounts } from '@/components/social-accounts';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDispenser } from '@/hooks/use-dispenser';

/**
 * Where the Instagram and X accounts are connected, next to the dispenser link.
 *
 * The account list itself lives in `SocialAccounts`, which starts the OAuth flow
 * and comes back through the `/oauth-return` route.
 */
export default function SettingsScreen() {
  const { status } = useDispenser();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="subtitle">Settings</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Connect the Instagram and X accounts that should post your doses, and manage the dispenser.
              </ThemedText>
            </View>
            <ConnectionChip status={status} />
          </View>

          <SocialAccounts />

          <ThemedText type="code" style={styles.sectionTitle}>
            dispenser
          </ThemedText>
          <ServoWidget />
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
  },
  content: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
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
  sectionTitle: {
    textTransform: 'uppercase',
  },
});
