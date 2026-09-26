import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, Platform, StyleSheet, Switch, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { socialRequest, type SocialAccount, type SocialProvider } from '@/lib/social-api';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

export function SocialAccounts() {
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    const result = await socialRequest<{ accounts: SocialAccount[] }>('/accounts');
    setAccounts(result.accounts);
    return result.accounts;
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to contact the server.'); }
    finally { locked.current = false; setBusy(false); }
  }, []);
  useEffect(() => { void run(async () => { await refresh(); }); }, [refresh, run]);

  const connect = (provider: SocialProvider) => run(async () => {
    const { browser_url } = await socialRequest<{ browser_url: string }>(`/auth/${provider}/mobile`, 'POST');
    const result = await WebBrowser.openAuthSessionAsync(browser_url, 'pilldispenser://oauth-return');
    if (result.type === 'success') {
      const returned = new URL(result.url);
      if (returned.searchParams.get('status') !== 'success') throw new Error('Sign-in failed or was denied. Please try again.');
      const current = await refresh();
      if (!current.some(account => account.provider === provider)) throw new Error('Account connection was not confirmed by the server.');
      setNotice('Account connected. Notification assignment is enabled; no post was sent.');
    } else {
      await refresh();
      setNotice('Sign-in closed. Account status refreshed.');
    }
  });
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="subtitle">Social accounts</ThemedText>
      <ThemedText>Connect accounts for missed-dose posts. Connecting does not publish anything.</ThemedText>
      <ThemedText type="small">Instagram requires a professional account and an image for posts. Disconnect removes the server connection; revoke app access on the social site separately.</ThemedText>
      {Platform.OS === 'web' ? <ThemedText>Connect accounts from the mobile app.</ThemedText> : null}
      {busy ? <ActivityIndicator accessibilityLabel="Updating social accounts" /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {notice ? <ThemedText accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
      {(['x', 'instagram'] as const).map(provider => {
        const account = accounts?.find(item => item.provider === provider);
        const label = provider === 'x' ? 'X' : 'Instagram';
        return <View key={provider} style={styles.account}>
          <ThemedText>{label}: {account ? `@${account.username}` : accounts ? 'Not connected' : 'Status unavailable'}</ThemedText>
          {account ? <>
            <View style={styles.row}>
              <ThemedText>Use for missed-dose posts</ThemedText>
              <Switch accessibilityLabel={`${label} missed-dose posts`} disabled={busy} value={account.assigned}
                onValueChange={assigned => void run(async () => {
                  await socialRequest(`/accounts/${provider}`, 'PATCH', { assigned }); await refresh();
                })} />
            </View>
            <Button title={`Disconnect ${label}`} disabled={busy} onPress={() => Alert.alert(
              `Disconnect ${label}?`, 'This removes the account from this demo server.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => void run(async () => {
                await socialRequest(`/accounts/${provider}`, 'DELETE'); await refresh();
              }) }],
            )} />
          </> : <Button title={`Connect ${label}`} disabled={busy || Platform.OS === 'web'} onPress={() => void connect(provider)} />}
        </View>;
      })}
      <Button title="Refresh accounts" disabled={busy} onPress={() => void run(async () => { await refresh(); })} />
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', padding: 20, borderRadius: 20, gap: 12 },
  account: { gap: 8, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
});
