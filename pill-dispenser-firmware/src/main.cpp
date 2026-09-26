#include <Arduino.h>
#include <ESP32Servo.h>
#include "NimBLEDevice.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define SERVO_TARGET_UUID    "48f7d908-c8b4-4066-a809-c67e4bdb2b86"
#define DEVICE_NAME         "ESP32-PillDispenser"
#define SERVO_PIN           13
#define A                   0.2347
#define B                   0.051


Servo myServo;
NimBLEServer *pServer;
NimBLECharacteristic *servoTarget;
float velocity;

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
  servoTarget = pService->createCharacteristic(
    SERVO_TARGET_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::WRITE
  );
  servoTarget->setValue("0");

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
  Serial.print("Servo attached? ");
  Serial.println(myServo.attached() ? "true" : "false");

  int servoTargetVal = servoTarget->getValue<int>();
  myServo.write(servoTargetVal);

  Serial.print("Servo Val: ");
  Serial.println(myServo.read());
  velocity = A + B * (myServo.read() - 96);
  Serial.print("Velocity: ");
  Serial.println(velocity);

  // Serial.print("Num Bluetooth Devices Connected: ");
  // Serial.println(pServer->getConnectedCount());
  delay(100);
}