#pragma once
#include "NimBLEDevice.h"

// Demo identity: UUID 7f16a970-9c42-4d4a-a481-bab01e7d1001, major 1, minor 1.
// Manufacturer company ID is little endian; iBeacon major/minor are big endian.
static const uint8_t DISPENSER_BEACON[] = {
  0x4c,0x00,0x02,0x15,0x7f,0x16,0xa9,0x70,0x9c,0x42,0x4d,0x4a,
  0xa4,0x81,0xba,0xb0,0x1e,0x7d,0x10,0x01,0x00,0x01,0x00,0x01,0xc5
};

class BeaconServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    // A GATT connection normally stops advertising. Resume the beacon while connected.
    // Non-connectable advertising avoids exhausting the controller's connection slots.
    NimBLEDevice::getAdvertising()->setConnectableMode(BLE_GAP_CONN_MODE_NON);
    NimBLEDevice::startAdvertising();
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    auto* advertising = NimBLEDevice::getAdvertising();
    advertising->stop();
    advertising->setConnectableMode(BLE_GAP_CONN_MODE_UND);
    advertising->start();
  }
};
static BeaconServerCallbacks beaconServerCallbacks;

inline void configureDispenserBeacon(const char* serviceUUID) {
  NimBLEAdvertisementData beacon;
  beacon.setFlags(0x06);
  beacon.setManufacturerData(std::string(reinterpret_cast<const char*>(DISPENSER_BEACON), sizeof(DISPENSER_BEACON)));
  // The beacon consumes 30 of the 31 advertisement bytes. Keep GATT discovery
  // in the scan response, with a short name to stay within its separate 31 bytes.
  NimBLEAdvertisementData response;
  response.addServiceUUID(NimBLEUUID(serviceUUID));
  response.setName("TiMED");
  auto* advertising = NimBLEDevice::getAdvertising();
  advertising->enableScanResponse(true);
  advertising->setAdvertisementData(beacon);
  advertising->setScanResponseData(response);
  advertising->setMinInterval(160); // 100 ms in 0.625 ms units
  advertising->setMaxInterval(240); // 150 ms
}
