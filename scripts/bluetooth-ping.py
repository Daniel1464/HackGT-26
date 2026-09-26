import asyncio
from bleak import BleakScanner, BleakClient

async def main():
    devices = await BleakScanner.discover()
    for device in devices:
        print(device)
    async with BleakClient("1BE86AC8-1E66-B862-80E9-B5485092BA10") as client:
        model_number = await client.read_gatt_char("48f7d908-c8b4-4066-a809-c67e4bdb2b86")
        print(f"Counter: {model_number.decode()}")

if __name__ == "__main__":
    asyncio.run(main())