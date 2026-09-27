# Beacon proximity

The firmware advertises iBeacon UUID `7f16a970-9c42-4d4a-a481-bab01e7d1001`,
major `1`, minor `1`, every 100–150 ms. The measured-power byte is a demo
placeholder (-59 dBm), not a calibrated distance measurement. GATT service UUID
is unchanged and lives in the scan response with the short name `TiMED`.
Advertising resumes after GATT connection so the beacon remains visible.

The local Expo module in `modules/timed-beacon` provides `start`, `stop`, and
`getStatus`. iOS uses CoreLocation region callbacks and an AppDelegate subscriber
to restore its delegate on background relaunch. Callbacks persist their state in
UserDefaults without requiring JS. Android 8+ uses a manufacturer-filtered BLE
scan with a PendingIntent/private receiver; results persist in SharedPreferences
without a live React screen. The Settings card reads those native snapshots.

## Setup and verify

1. Build and flash firmware. Rebuild/install the native phone app (not Expo Go).
   Local modules must appear in Expo autolinking for both platforms.
2. On iPhone open Settings → Dispenser proximity → Enable. Accept the initial
   location prompt. TiMED then requests Always access for background monitoring;
   iOS may defer its final Always confirmation. If status still asks for Always,
   use iPhone Settings → TiMED → Location → Always. Enable Bluetooth and
   Background App Refresh.
3. Android: grant precise location and Nearby Devices. On Android 11+, open phone
   settings and select location “Allow all the time”, then tap Enable again.
4. Check detection with GATT disconnected, then connected. Verify medication
   reads/writes still work (the service is now in the scan response).
5. Background/lock the phone, move out of range and return. Reopen the app and
   check the persisted observation timestamp/state. Test on both actual phones.
6. Android: re-enable after reboot or force-stop. OEM battery restrictions may
   prevent scan delivery. No boot receiver/foreground service is installed.

## Boundaries

This is region presence, not geographical position or a precise distance.
Neither OS guarantees instant background detection or force-quit recovery.
iOS reports inside/outside/unknown region state, not a continuous heartbeat.
Android reports a received beacon as inside for 120 seconds, then unknown;
missing packets are NOT asserted to mean outside. Delayed/batched packets use
their observation timestamps rather than receipt time. There is no reliable
30-second absence guarantee on a suspended phone.

No automatic dispensing, dose-state changes, social posts, server uploads or
notifications are triggered by this module. Those require an explicit policy
for stale/unknown presence. The native callback persistence points are where
future background actions can be integrated; ordinary JS callbacks alone do
not survive suspension. Never treat a beacon as authenticated proximity: its
identity can be copied. All demo boards share this identity; assign different
minor IDs (and match in the app) if using multiple dispensers.

Native Swift/Kotlin compilation and RF/background behavior require device-build
verification. This Windows workspace cannot validate iOS compilation.
