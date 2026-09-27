package expo.modules.timedbeacon

import android.Manifest
import android.app.PendingIntent
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanSettings
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private object BeaconScanner {
  fun prefs(context: Context) = context.getSharedPreferences("timed.beacon", Context.MODE_PRIVATE)
  fun permitted(context: Context): Boolean {
    val permissions = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
    if (Build.VERSION.SDK_INT >= 29) permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    if (Build.VERSION.SDK_INT >= 31) permissions.addAll(listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT))
    return permissions.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
  }
  fun pending(context: Context): PendingIntent {
    // Mutable is required for the OS to attach scan results; the receiver is explicit/private.
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(context, 711, Intent(context, BeaconReceiver::class.java), flags)
  }
  fun scanner(context: Context): BluetoothLeScanner? = context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner
  fun start(context: Context) {
    check(Build.VERSION.SDK_INT >= 26) { "Background beacon scanning requires Android 8 or later" }
    check(permitted(context)) { "Allow precise location, background location and nearby devices in Settings" }
    val scanner = scanner(context) ?: error("Turn on Bluetooth")
    // Apple manufacturer ID is supplied separately. Match iBeacon type+UUID+major+minor, not TX power.
    val data = byteArrayOf(0x02,0x15,0x7f,0x16,0xa9.toByte(),0x70,0x9c.toByte(),0x42,0x4d,0x4a,0xa4.toByte(),0x81.toByte(),0xba.toByte(),0xb0.toByte(),0x1e,0x7d,0x10,0x01,0x00,0x01,0x00,0x01)
    val filter = ScanFilter.Builder().setManufacturerData(0x004c, data, ByteArray(data.size) { 0xff.toByte() }).build()
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build()
    scanner.stopScan(pending(context))
    val result = scanner.startScan(listOf(filter), settings, pending(context))
    check(result == 0) { "Beacon scan could not start: $result" }
    prefs(context).edit().putBoolean("enabled", true).remove("time").remove("error").apply()
  }
  fun stop(context: Context) {
    prefs(context).edit().putBoolean("enabled", false).remove("time").apply()
    if (Build.VERSION.SDK_INT >= 26 && permitted(context)) scanner(context)?.stopScan(pending(context))
  }
  fun status(context: Context): Map<String, Any> {
    val p = prefs(context)
    val allowed = permitted(context)
    val enabled = p.getBoolean("enabled", false)
    val last = p.getLong("time", 0)
    val fresh = System.currentTimeMillis() - last in 0L..120000L
    val bluetooth = allowed && scanner(context) != null
    return mapOf("enabled" to enabled, "state" to if (enabled && allowed && bluetooth && fresh) "inside" else "unknown",
      "observedAt" to last.toDouble(), "permission" to if (allowed) "granted" else "Background location and nearby devices required",
      "backgroundAvailable" to bluetooth, "error" to (p.getString("error", "") ?: ""))
  }
}

class BeaconReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val p = BeaconScanner.prefs(context)
    if (!p.getBoolean("enabled", false)) return
    val error = intent.getIntExtra(BluetoothLeScanner.EXTRA_ERROR_CODE, 0)
    if (error != 0) {
      p.edit().remove("time").putString("error", "Background scan error: $error").apply()
      return
    }
    @Suppress("DEPRECATION")
    val results = intent.getParcelableArrayListExtra<ScanResult>(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT)
    if (!results.isNullOrEmpty()) {
      val latest = results.maxOf { it.timestampNanos }
      val ageMs = ((SystemClock.elapsedRealtimeNanos() - latest) / 1000000).coerceAtLeast(0)
      val observedAt = System.currentTimeMillis() - ageMs
      if (observedAt > p.getLong("time", 0)) p.edit().putLong("time", observedAt).remove("error").apply()
    }
  }
}

class TimedBeaconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TimedBeacon")
    AsyncFunction("start") { BeaconScanner.start(requireNotNull(appContext.reactContext)) }
    AsyncFunction("stop") { BeaconScanner.stop(requireNotNull(appContext.reactContext)) }
    AsyncFunction("getStatus") { BeaconScanner.status(requireNotNull(appContext.reactContext)) }
  }
}
