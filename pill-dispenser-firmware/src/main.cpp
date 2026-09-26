#include <Arduino.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include "NimBLEDevice.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define SERVO_TARGET_UUID    "48f7d908-c8b4-4066-a809-c67e4bdb2b86"
#define TIME_UUID           "5a84b053-9bfe-4f27-8c2a-c4dce2bf537f"
#define MEDICINE_UUID       "9c8b3e10-74d5-4e36-a5a1-938871102001"
#define DEVICE_NAME         "ESP32-PillDispenser"
#define SERVO_PIN           13
#define BEAM_BREAK_PIN      27
#define BEAM_BREAK_ACTIVE_LOW true
#define A                   0.2347
#define B                   0.051

// Doses are stored verbatim as the received packet:
// [medicine ID:u8][minutes since midnight UTC:u16 LE][dose:u32 LE].
constexpr size_t MEDICINE_DOSE_BYTES = 7;
constexpr size_t MEDICINE_MAX_DOSES = 32;


Servo myServo;
NimBLEServer *pServer;
NimBLECharacteristic *servoTarget;
NimBLECharacteristic *timeCharacteristic;
Preferences persistentStorage;
bool persistentStorageReady = false;

/**
 * Open the ESP32 NVS namespace used for pill-dispenser settings.
 * Values written through this namespace survive resets and power loss.
 */
bool beginPersistentStorage() {
  persistentStorageReady = persistentStorage.begin("pilldata", false);
  return persistentStorageReady;
}

/** Write a raw byte buffer under key. Returns false if NVS is unavailable. */
bool writePersistentBytes(const char *key, const uint8_t *data, size_t length) {
  if (!persistentStorageReady || key == nullptr || data == nullptr || length == 0) return false;
  return persistentStorage.putBytes(key, data, length) == length;
}

/** Read raw bytes from key into buffer, returning the number of bytes read. */
size_t readPersistentBytes(const char *key, uint8_t *buffer, size_t capacity) {
  if (!persistentStorageReady || key == nullptr || buffer == nullptr) return 0;
  if (!persistentStorage.isKey(key)) return 0;
  const size_t length = persistentStorage.getBytesLength(key);
  if (length == 0 || length > capacity) return 0;
  return persistentStorage.getBytes(key, buffer, length);
}

/** Write a signed 32-bit integer under key. Returns false if NVS is unavailable. */
bool writePersistentInt(const char *key, int32_t value) {
  if (!persistentStorageReady || key == nullptr) return false;
  return persistentStorage.putInt(key, value) > 0;
}

/** Read a signed 32-bit integer, returning defaultValue when the key is absent. */
int32_t readPersistentInt(const char *key, int32_t defaultValue = 0) {
  if (!persistentStorageReady || key == nullptr || !persistentStorage.isKey(key)) return defaultValue;
  return persistentStorage.getInt(key, defaultValue);
}

String medicineStorageKey(uint8_t medicineId) {
  return String("medicine") + String(medicineId);
}

/**
 * Read a stored medicine record into buffer, returning the number of bytes read.
 *
 * A record is a whole number of fixed-size dose entries, so a length that is
 * not a multiple of MEDICINE_DOSE_BYTES is treated as absent/corrupt.
 */
size_t readMedicineRecord(uint8_t medicineId, uint8_t *buffer, size_t capacity) {
  if (medicineId > 1) return 0;
  const String key = medicineStorageKey(medicineId);
  const size_t bytes = readPersistentBytes(key.c_str(), buffer, capacity);
  if (bytes % MEDICINE_DOSE_BYTES != 0) return 0;
  return bytes;
}

/** Persist a raw medicine record (a whole number of dose entries) for ID. */
bool writeMedicineRecord(uint8_t medicineId, const uint8_t *data, size_t length) {
  if (medicineId > 1 || data == nullptr || length == 0 ||
      length > MEDICINE_DOSE_BYTES * MEDICINE_MAX_DOSES ||
      length % MEDICINE_DOSE_BYTES != 0) return false;
  const String key = medicineStorageKey(medicineId);
  return writePersistentBytes(key.c_str(), data, length);
}

constexpr size_t MEDICINE_PACKET_BYTES = 7;
constexpr uint32_t MEDICINE_TRANSFER_GAP_MS = 2000;
uint32_t lastMedicinePacketAt = 0;
uint8_t activeMedicinePacketId = 0;
bool medicinePacketSessionActive = false;

bool appendMedicineDosePacket(const std::string &packet) {
  if (packet.size() != MEDICINE_PACKET_BYTES) return false;
  const uint8_t medicineId = static_cast<uint8_t>(packet[0]);
  const uint16_t minutes = static_cast<uint8_t>(packet[1]) |
    (static_cast<uint16_t>(static_cast<uint8_t>(packet[2])) << 8);
  const uint32_t dose = static_cast<uint8_t>(packet[3]) |
    (static_cast<uint32_t>(static_cast<uint8_t>(packet[4])) << 8) |
    (static_cast<uint32_t>(static_cast<uint8_t>(packet[5])) << 16) |
    (static_cast<uint32_t>(static_cast<uint8_t>(packet[6])) << 24);
  if (medicineId > 1 || minutes >= 24 * 60 || dose == 0 || dose > INT32_MAX) return false;

  const uint32_t now = millis();
  const bool newTransfer = !medicinePacketSessionActive || activeMedicinePacketId != medicineId ||
    static_cast<uint32_t>(now - lastMedicinePacketAt) > MEDICINE_TRANSFER_GAP_MS;

  uint8_t record[MEDICINE_DOSE_BYTES * MEDICINE_MAX_DOSES];
  size_t used = 0;
  if (newTransfer) {
    // A new transfer replaces whatever was stored for this medicine.
    used = 0;
  } else {
    used = readMedicineRecord(medicineId, record, sizeof(record));
    if (used == 0) return false;
  }
  if (used + MEDICINE_DOSE_BYTES > sizeof(record)) return false;

  // Store the packet verbatim so the persisted layout matches the wire format.
  memcpy(record + used, packet.data(), MEDICINE_DOSE_BYTES);
  used += MEDICINE_DOSE_BYTES;

  const bool saved = writeMedicineRecord(medicineId, record, used);
  if (saved) {
    activeMedicinePacketId = medicineId;
    lastMedicinePacketAt = now;
    medicinePacketSessionActive = true;
  }
  return saved;
}

// Each write is one binary packet: [medicine ID:u8][minutes since midnight UTC:u16 LE][dose:u32 LE].
class MedicineCallbacks : public NimBLECharacteristicCallbacks {
public:
  void onRead(NimBLECharacteristic *characteristic, NimBLEConnInfo &info) override {
    uint8_t record[MEDICINE_DOSE_BYTES * MEDICINE_MAX_DOSES];
    const bool id0Filled = readMedicineRecord(0, record, sizeof(record)) > 0;
    const bool id1Filled = readMedicineRecord(1, record, sizeof(record)) > 0;
    characteristic->setValue(id0Filled && id1Filled ? "SLOTS:11" :
      id0Filled ? "SLOTS:10" : id1Filled ? "SLOTS:01" : "SLOTS:00");
  }

  void onWrite(NimBLECharacteristic *characteristic, NimBLEConnInfo &info) override {
    const std::string packet = characteristic->getValue();
    const bool saved = appendMedicineDosePacket(packet);
    characteristic->setValue(saved ? "SAVED" : "ERROR:packet");
    Serial.println(saved ? "Medicine dose packet saved to flash" : "Invalid medicine dose packet");
  }
};
MedicineCallbacks medicineCallbacks;

uint64_t syncedUtcSeconds = 0;
uint32_t syncedAtMillis = 0;
bool clockSynchronized = false;
std::string lastTimePayload;
// Last UTC minute (0..1439) we checked the schedule for; 0xFFFF means "never".
uint16_t lastCheckedMinute = 0xFFFF;

uint64_t currentUtcSeconds() {
  if (!clockSynchronized) return 0;
  return syncedUtcSeconds + (static_cast<uint32_t>(millis() - syncedAtMillis) / 1000ULL);
}

void syncClockFromCharacteristic() {
  const std::string payload = timeCharacteristic->getValue();
  if (payload.empty() || payload == lastTimePayload) return;
  lastTimePayload = payload;

  char *end = nullptr;
  const unsigned long long parsed = strtoull(payload.c_str(), &end, 10);
  if (end == payload.c_str() || *end != '\0' || parsed == 0) {
    Serial.println("Invalid UTC time received.");
    return;
  }

  syncedUtcSeconds = parsed;
  syncedAtMillis = millis();
  clockSynchronized = true;
  Serial.print("UTC clock synchronized to ");
  Serial.println(static_cast<unsigned long>(syncedUtcSeconds));
}

/**
 * Check the current UTC minute against the stored dispensing times.
 *
 * Records are only read from NVS when the minute changes, so the persistent
 * cache is not hit on every loop iteration.
 */
void checkMedicineSchedule() {
  if (!clockSynchronized) return;

  const uint16_t minutesNow = static_cast<uint16_t>((currentUtcSeconds() / 60) % (24 * 60));
  if (minutesNow == lastCheckedMinute) return;
  lastCheckedMinute = minutesNow;

  uint8_t record[MEDICINE_DOSE_BYTES * MEDICINE_MAX_DOSES];
  for (uint8_t medicineId = 0; medicineId <= 1; medicineId++) {
    const size_t used = readMedicineRecord(medicineId, record, sizeof(record));
    for (size_t offset = 0; offset + MEDICINE_DOSE_BYTES <= used; offset += MEDICINE_DOSE_BYTES) {
      const uint16_t minutes = static_cast<uint16_t>(record[offset + 1]) |
        (static_cast<uint16_t>(record[offset + 2]) << 8);
      if (minutes == minutesNow) {
        Serial.println("time to take medicine");
      }
    }
  }
}

/** Print the cached medicine records (one line per medicine) to serial. */
void printMedicineCache() {
  uint8_t record[MEDICINE_DOSE_BYTES * MEDICINE_MAX_DOSES];
  for (uint8_t medicineId = 0; medicineId <= 1; medicineId++) {
    const size_t used = readMedicineRecord(medicineId, record, sizeof(record));
    Serial.print("Medicine ");
    Serial.print(medicineId);
    Serial.print(" cached doses: ");
    if (used == 0) {
      Serial.println("none");
      continue;
    }
    for (size_t offset = 0; offset + MEDICINE_DOSE_BYTES <= used; offset += MEDICINE_DOSE_BYTES) {
      const uint16_t minutes = static_cast<uint16_t>(record[offset + 1]) |
        (static_cast<uint16_t>(record[offset + 2]) << 8);
      const uint32_t dose = static_cast<uint32_t>(record[offset + 3]) |
        (static_cast<uint32_t>(record[offset + 4]) << 8) |
        (static_cast<uint32_t>(record[offset + 5]) << 16) |
        (static_cast<uint32_t>(record[offset + 6]) << 24);
      char timeText[6];
      snprintf(timeText, sizeof(timeText), "%02u:%02u", minutes / 60, minutes % 60);
      Serial.print(timeText);
      Serial.print(" UTC dose ");
      Serial.print(dose);
      Serial.print("; ");
    }
    Serial.println();
  }
}

void setupBluetooth() {
  // Initialize the device with a local name
  NimBLEDevice::init(DEVICE_NAME);
  pServer = NimBLEDevice::createServer();
  NimBLEService *pService = pServer->createService(SERVICE_UUID);
  pServer->advertiseOnDisconnect(true);

  // Note: make sure to initialize characteristics 
  // (the topics in which data is broadcasted over)
  // before calling startAdvertising()
  servoTarget = pService->createCharacteristic(
    SERVO_TARGET_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  timeCharacteristic = pService->createCharacteristic(
    TIME_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  servoTarget->setValue("0");
  timeCharacteristic->setValue("0");
  NimBLECharacteristic *medicine = pService->createCharacteristic(
    MEDICINE_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE);
  medicine->setCallbacks(&medicineCallbacks);
  medicine->setValue("IDLE");

  pService->start();

  NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setName(DEVICE_NAME);
  pAdvertising->enableScanResponse(true); // Helps iOS devices discover it
  
  NimBLEDevice::startAdvertising();
  Serial.println("Advertising started! Check your phone.");
}

int state = 0;
bool stopped = true;

void servoActionInit() {
  stopped = false;
  state = 0;
}

bool servoActionLoop() {
  if (myServo.read() > 170) {
    stopped = true;
  } else if (state == 0) {
    myServo.write(myServo.read() + 30);
    state = 1;
  } else if (state == 1) {
    myServo.write(myServo.read() - 15);
    state = 0;
  } else {
    servoActionInit();
  }
  return stopped;
}

void setup() {
  Serial.begin(115200);
  if (!beginPersistentStorage()) {
    Serial.println("Warning: persistent storage could not be opened.");
  }
  pinMode(BEAM_BREAK_PIN, BEAM_BREAK_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  ESP32PWM::allocateTimer(0);
  myServo.setPeriodHertz(50);      // standard 50 Hz servo signal
  myServo.attach(SERVO_PIN, 1000, 2000); // min/max pulse widths in µs
  setupBluetooth();
}

int loopCounter = 0;

void loop() {
  loopCounter++;
  bool print = loopCounter % 10 == 0;
  syncClockFromCharacteristic();

  if (print) {
    Serial.print("Servo attached? ");
    Serial.println(myServo.attached() ? "true" : "false");
  }

  int servoTargetVal = servoTarget->getValue<int>();
  myServo.write(servoTargetVal);

  if (print) {
    Serial.print("Servo Val: ");
    Serial.println(myServo.read());
  }

  if (clockSynchronized) {
    const std::string currentTime = std::to_string(currentUtcSeconds());
    timeCharacteristic->setValue(currentTime);
    // Do not mistake the value we publish for a new app synchronization on
    // the next loop iteration.
    lastTimePayload = currentTime;
  }

  checkMedicineSchedule();
  if (print) {
    Serial.print("Num Devices Connected: ");
    Serial.println(pServer->getConnectedCount());
    Serial.print("UTC time: ");
    if (clockSynchronized) {
      Serial.println(static_cast<unsigned long>(currentUtcSeconds()));
    } else {
      Serial.println("not synchronized");
    }
    printMedicineCache();
  }
  // Serial.print("Num Bluetooth Devices Connected: ");
  // Serial.println(pServer->getConnectedCount());
  delay(100);
}
