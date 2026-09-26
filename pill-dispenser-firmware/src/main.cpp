#include <Arduino.h>
#include <ESP32Servo.h>
#include "NimBLEDevice.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define HELLO_WORLD_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define COUNTER_UUID        "48f7d908-c8b4-4066-a809-c67e4bdb2b86"
#define TIME_UUID           "5a84b053-9bfe-4f27-8c2a-c4dce2bf537f"
#define DEVICE_NAME         "ESP32-PillDispenser"
#define SERVO_PIN           13

Servo myServo;
int num = 0;
NimBLEServer *pServer;
NimBLECharacteristic *helloWorld;
NimBLECharacteristic *counter;
NimBLECharacteristic *timeCharacteristic;

uint64_t syncedUtcSeconds = 0;
uint32_t syncedAtMillis = 0;
bool clockSynchronized = false;
std::string lastTimePayload;

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

void setupBluetooth() {
  // Initialize the device with a local name
  NimBLEDevice::init(DEVICE_NAME);
  pServer = NimBLEDevice::createServer();
  NimBLEService *pService = pServer->createService(SERVICE_UUID);
  pServer->advertiseOnDisconnect(true);

  // Note: make sure to initialize characteristics 
  // (the topics in which data is broadcasted over)
  // before calling startAdvertising()
  helloWorld = pService->createCharacteristic(
    HELLO_WORLD_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  counter = pService->createCharacteristic(
    COUNTER_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  timeCharacteristic = pService->createCharacteristic(
    TIME_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  helloWorld->setValue("Hello World!");
  counter->setValue("0");
  timeCharacteristic->setValue("0");

  pService->start();

  NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setName(DEVICE_NAME);
  pAdvertising->enableScanResponse(true); // Helps iOS devices discover it
  
  NimBLEDevice::startAdvertising();
  Serial.println("Advertising started! Check your phone.");
}

void setup() {
  Serial.begin(115200);
  ESP32PWM::allocateTimer(0);
  myServo.setPeriodHertz(50);      // standard 50 Hz servo signal
  myServo.attach(SERVO_PIN, 1000, 2000); // min/max pulse widths in µs
  setupBluetooth();
}

void loop() {
  syncClockFromCharacteristic();
  num++;
  counter->setValue(std::to_string(num));
  if (clockSynchronized) {
    const std::string currentTime = std::to_string(currentUtcSeconds());
    timeCharacteristic->setValue(currentTime);
    // Do not mistake the value we publish for a new app synchronization on
    // the next loop iteration.
    lastTimePayload = currentTime;
  }
  Serial.print("Num Devices Connected: ");
  Serial.println(pServer->getConnectedCount());
  Serial.print("UTC time: ");
  if (clockSynchronized) {
    Serial.println(static_cast<unsigned long>(currentUtcSeconds()));
  } else {
    Serial.println("not synchronized");
  }
  delay(1000);
}
