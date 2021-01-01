# Bluetooth Low-Energy Peripheral Device
[![NPM](https://img.shields.io/npm/v/bluetooth-device.svg)](https://www.npmjs.com/package/bluetooth-device)
[![Build Status](https://travis-ci.com/dokmic/bluetooth-device.svg?branch=master)](https://travis-ci.com/dokmic/bluetooth-device)

This package provides an abstraction layer on top of the Bluetooth Low-Energy (BLE) peripheral device.

## Get Started
```bash
npm install --save bluetooth-device
```

## Usage
```typescript
import { BluetoothDevice } from 'bluetooth-device';

const HANDLE_TEMPERATURE_READ = 1234;
const HANDLE_TEMPERATURE_WRITE = 5678;

const thermostat = new BluetoothDevice('11:22:33:44:55:66', { timeout: 1000 });
const temperature = await thermostat.read(HANDLE_TEMPERATURE_READ);

await thermostat.write(HANDLE_TEMPERATURE_WRITE, temperature + 10);
```

You can also extend your peripheral from the `BluetoothDevice` base class.
```typescript
import { BluetoothDevice } from 'bluetooth-device';

const TEMPERATURE_MIN = 10;
const TEMPERATURE_MAX = 40;

const HANLDE_READ = 1234;
const HANDLE_WRITE = 5678;

export class Thermostat extends BluetoothDevice {
  async setTemperature(temperature: number): Promise<void> {
    const value = Math.min(Math.max(TEMPERATURE_MIN, temperature), TEMPERATURE_MAX);

    return await this.write(HANDLE_WRITE, value);
  }

  getTemperature(): Promise<number> {
    return this.read(HANLDE_READ);
  }
}
```

## API
### `constructor`
Initializes a Bluetooth device instance.

```typescript
constructor(address: string, options?: object)
```
- `address` - Bluetooth address.
- `options` - Device options.
  - `discoveryTimeout` - Device discovery timeout in milliseconds. By default, it equals 30 seconds.
  - `idleTimeout` - Device idle timeout in milliseconds. After that, the connection will be destroyed. By default, it equals to 2 minutes.
  - `retries` - The number of retries on failed operations. By default, it is 3.
  - `timeout` - Device operations timeout, namely, connection, read, and write. By default, it equals 10 seconds.

### `discover`
Discovers peripheral device by address.

```typescript
discover(): Promise<void>
```

### `connect`
Tries to establish a connection with the device.
If the device was not previously discovered, the discovery operation will be performed before.

```typescript
connect(): Promise<void>
```

### `disconnect`
Destroys a connection with the device.

```typescript
disconnect(): Promise<void>
```

### `notify`
Waits for the next notification.
If the device was not previously connected, the connection will be established automatically.

```typescript
notify(handle: number): Promise<Buffer>
```
- `handle` - The notification handle.

### `read`
Reads data from the device.
If the device was not previously connected, the connection will be established automatically.

```typescript
read(handle: number): Promise<Buffer>
```
- `handle` - The handle to read from.

### `write`
Writes data to the device.
If the device was not previously connected, the connection will be established automatically.

```typescript
write(handle: number, data: Buffer): Promise<void>
```
- `handle` - The write handle.
- `data` - The data buffer.
