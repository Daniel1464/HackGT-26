#include <Arduino.h>
#include <ESP32Servo.h>
#include "NimBLEDevice.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define HELLO_WORLD_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define COUNTER_UUID        "48f7d908-c8b4-4066-a809-c67e4bdb2b86"
#define DEVICE_NAME         "ESP32-PillDispenser"
#define SERVO_PIN           13

Servo myServo;
int num = 0;
NimBLEServer *pServer;
NimBLECharacteristic *helloWorld;
NimBLECharacteristic *counter;

void setupBluetooth() {
  // Initialize the device with a local name
  NimBLEDevice::init(DEVICE_NAME);
  pServer = NimBLEDevice::createServer();
  NimBLEService *pService = pServer->createService(SERVICE_UUID);
  pServer->advertiseOnDisconnect(true);
  pService->start();

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
  helloWorld->setValue("Hello World!");
  counter->setValue("0");

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
  num++;
  counter->setValue(std::to_string(num));
  Serial.print("Num Devices Connected: ");
  Serial.println(pServer->getConnectedCount());
  delay(1000);
}