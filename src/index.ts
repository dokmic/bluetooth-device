import PCancelable from 'p-cancelable';
import noble, { Peripheral } from '@abandonware/noble';
import { semaphore, timeout } from 'ts-async-decorators';

const DEFAULT_TIMEOUT_DISCOVERY = 30000;

/**
 * Bluetooth Device Options.
 */
interface BluetoothDeviceOptions {
  /**
   * Device discovery timeout in milliseconds.
   * By default, it equals 30 seconds.
   */
  discoveryTimeout?: number;
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
}
