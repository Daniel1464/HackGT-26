import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, View } from 'react-native';
import { ThemedText } from './themed-text';
import { getBeaconStatus, startBeaconMonitoring, stopBeaconMonitoring, type BeaconStatus } from '@/lib/beacon-proximity';

export function DispenserProximity() {
  const [status, setStatus] = useState<BeaconStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void getBeaconStatus().then(value => { if (mounted) setStatus(value); }).catch(cause => { if (mounted) setError(String(cause)); }); };
    refresh();
    const interval = setInterval(refresh, 3000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { mounted = false; clearInterval(interval); listener.remove(); };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); setStatus(await getBeaconStatus()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const label = !status?.enabled ? 'Off' : status.state === 'inside' ? 'Dispenser detected' : status.state === 'outside' ? 'Outside beacon region' : 'Unknown — no reliable current observation';
  return <View style={{ gap: 12 }}>
    <ThemedText type="subtitle" accessibilityRole="header">Dispenser proximity</ThemedText>
    <ThemedText accessibilityLiveRegion="polite">{label}</ThemedText>
    <ThemedText type="small">iOS asks for location access so CoreLocation can recognize the dispenser’s iBeacon. TiMED does not read or save GPS coordinates. Grant “Always” for background region alerts. iOS may show a separate upgrade prompt or ask you to change this in Settings. Detection can be delayed; it does not control dispensing.</ThemedText>
    {!!status?.observedAt && <ThemedText type="small">Last region observation: {new Date(status.observedAt).toLocaleString()}</ThemedText>}
    {status?.permission !== 'granted' && <ThemedText type="small">{status?.permission}</ThemedText>}
    {status?.enabled && !status.backgroundAvailable && <ThemedText type="small">Background detection unavailable. Check Bluetooth, location access and Background App Refresh.</ThemedText>}
    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void run(startBeaconMonitoring)} style={{ padding: 16, minHeight: 56, backgroundColor: '#2444CB', borderRadius: 12 }}>
      <ThemedText style={{ color: '#fff' }}>Enable / retry beacon monitoring</ThemedText>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(stopBeaconMonitoring)} style={{ padding: 16, minHeight: 56 }}><ThemedText>Stop beacon monitoring</ThemedText></Pressable>
    <Pressable accessibilityRole="button" onPress={() => void run(() => Linking.openSettings())} style={{ padding: 16, minHeight: 56 }}><ThemedText>Open phone permissions</ThemedText></Pressable>
    {!!(error || status?.error) && <ThemedText accessibilityLiveRegion="polite">{error || status?.error}</ThemedText>}
  </View>;
}
