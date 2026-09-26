# Voice → medicine packets → ESP32

The Expo app includes the ElevenLabs Conversational AI agent **Medication Assistant** (`agent_9101m3e5mt3ne7xv0mnaxm23dwwe`). The assistant calls the `save_medicine_schedule` client tool when it has a complete schedule. The client validates the medicine schema and sends one fixed-size binary packet per dose over BLE. The device stores the schedule in its medicine0/medicine1 NVS slot. Saving does not dispense pills or implement scheduling.

## Run

1. In the ElevenLabs dashboard, add a client tool named `save_medicine_schedule` to the agent. Its input schema should be `{ "medicine": "string", "id": "number (0 or 1)", "data": [{ "time": "HH:MM UTC", "dose": "integer" }] }`.
2. In `pill-dispenser-app`, run `npm install`, then create a native development build: `npx expo prebuild --clean` followed by `npx expo run:android` (or `npx expo run:ios`). Expo Go is not sufficient because the agent uses native WebRTC audio. Flash the updated firmware via PlatformIO.
3. Connect to the dispenser, tap **Talk to assistant**, and speak the schedule. The client tool validates it and sends the binary dose packets over BLE.

The previous Scribe/manual transcription component remains in the source as a fallback, but the servo screen uses the live agent by default. `server.mjs` is retained as an optional proxy implementation for future use; the app no longer calls it.

## Supported speech

“Medicine Vitamin A, ID zero, at eight AM UTC dose two and at eight PM UTC dose one.”

Result: `{"medicine":"Vitamin A","id":0,"data":[{"time":"08:00 UTC","dose":2},{"time":"20:00 UTC","dose":1}]}`

Use explicit UTC times (24-hour `08:30` or AM/PM), IDs zero/one, positive integer doses. Number words zero–twelve are supported. Unrecognized phrasing is rejected; edit the transcript or JSON. Relative dates, local time conversion, and unrestricted natural-language extraction are not implemented.

## BLE protocol

Service is the existing dispenser service. New READ/WRITE characteristic: `9c8b3e10-74d5-4e36-a5a1-938871102001`.

Send one 7-byte binary packet per dose: `[medicine id:u8][minutes since midnight UTC:u16 little-endian][dose:u32 little-endian]`. Each packet uses BLE write-with-response; the firmware prints `Medicine dose packet saved to flash` or `Invalid medicine dose packet`. Packets for the same medicine sent within two seconds form one schedule; a later transfer starts a fresh dose list. The medicine name is retained from the stored record, or defaults to `Medicine 0`/`Medicine 1` when no name exists.

## Hardware check

Parser tests: `node --test voice-server/medicine.test.mjs` from the repository root (Node 24, or Node 22 with TypeScript stripping enabled).

Connect a native phone; record the example; review and save. Expect “Medicine JSON saved to flash” in Serial. Read `readMedicineJson(0)` after a reboot to confirm persistence. Disconnect during upload and retry; incomplete uploads must not overwrite the saved record. Test invalid JSON and an invalid ElevenLabs key to verify errors.
