import PCancelable from 'p-cancelable';
import noble, { Peripheral } from '@abandonware/noble';
import { before, semaphore, timeout } from 'ts-async-decorators';

const DEFAULT_TIMEOUT_DISCOVERY = 30000;
const DEFAULT_TIMEOUT = 10000;

/**
 * Bluetooth Device Options.
 */
interface BluetoothDeviceOptions {
  /**
   * Device discovery timeout in milliseconds.
   * By default, it equals 30 seconds.
   */
  discoveryTimeout?: number;

  /**
   * Device operations timeout, namely, connection, read, and write.
   * By default, it equals 10 seconds.
   */
  timeout?: number;
}

/**
 * Bluetooth Device Abstraction.
 */
export class BluetoothDevice {
  private peripheral?: Peripheral;

  /**
   * @param address Bluetooth address.
   * @param options Device options.
   */
  constructor(readonly address: string, private options: BluetoothDeviceOptions = {}) {}

  /**
   * Discovers peripheral device by address.
   * @returns Discovery promise.
   */
  @semaphore({ limit: 1 })
  @timeout({
    timeout(this: BluetoothDevice) {
      return this.options.discoveryTimeout ?? DEFAULT_TIMEOUT_DISCOVERY;
    },
    reason: 'Discovery timeout.',
  })
  discover(): PCancelable<void> {
    return new PCancelable(async (resolve, reject, onCancel) => {
      if (this.peripheral) {
        resolve();
      }

      const stop = () => {
        noble.stopScanning();
        /* eslint-disable no-use-before-define */
        noble.removeListener('stateChange', onStateChange);
        noble.removeListener('discover', onDiscover);
        /* eslint-enable no-use-before-define */
      };

      const onDiscover = (peripheral: Peripheral) => {
        if (peripheral.address !== this.address.toLowerCase()) {
          return;
        }

        this.peripheral = peripheral;
        stop();
        resolve();
      };

      const onStateChange = (state: string) =>
        state === 'poweredOn' ? noble.startScanningAsync() : noble.stopScanning();

      onCancel(stop);
      noble.on('discover', onDiscover);
      noble.on('stateChange', onStateChange);

      if (noble.state === 'poweredOn') {
        await noble.startScanningAsync();
      }
    });
  }

  /**
   * Tries to establish a connection with the device.
   * If the device was not previously discovered, the discovery operation will be performed before.
   * @returns Connection promise.
   */
  @before({ action: (device: BluetoothDevice) => device.discover(), wait: true })
  @timeout({
    timeout(this: BluetoothDevice) {
      return this.options.timeout ?? DEFAULT_TIMEOUT;
    },
    reason: 'Connection timeout.',
  })
  connect(): PCancelable<void> {
    return new PCancelable((resolve, reject, onCancel) => {
      if (this.peripheral?.state === 'connected') {
        return resolve();
      }

      const onConnect = (error?: string) => (error ? reject(new Error(error)) : resolve());
      const onDisconnect = () => this.peripheral?.connect(onConnect);

      onCancel(() => {
        this.peripheral?.removeListener('connect', onConnect);
        this.peripheral?.removeListener('disconnect', onDisconnect);
      });

      if (this.peripheral?.state === 'connecting') {
        return this.peripheral?.once('connect', onConnect);
      }

      if (this.peripheral?.state === 'disconnecting') {
        return this.peripheral?.once('disconnect', onDisconnect);
      }

      return onDisconnect();
    });
  }
}
