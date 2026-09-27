import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DispenserProximity } from '@/components/dispenser-proximity';
import { SocialAccounts } from '@/components/social-accounts';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';

export default function SettingsScreen() {
  return <ThemedView style={styles.screen}>
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText accessibilityRole="header" type="subtitle">Settings</ThemedText>
        <ThemedText>Set up location sharing and phone reminders here. Use the Home talk button to manage your medicines.</ThemedText>
        <DispenserProximity />
        <SocialAccounts />
      </ScrollView>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: 20, gap: 20, paddingBottom: BottomTabInset + 24 },
});
