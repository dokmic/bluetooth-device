import PCancelable from 'p-cancelable';
import noble, { Peripheral } from '@abandonware/noble';
import { after, before, debounce, retry, semaphore, timeout } from 'ts-async-decorators';

const DEFAULT_TIMEOUT_IDLE = 120000;
const DEFAULT_TIMEOUT_DISCOVERY = 30000;
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_NUMBER_OF_RETRIES = 3;

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
   * Device idle timeout in milliseconds. After that, the connection will be destroyed.
   * By default, it equals to 2 minutes.
   */
  idleTimeout?: number;

  /**
   * The number of retries on failed operations.
   * By default, it is 3.
   */
  retries?: number;

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
  @after({ action: (device: BluetoothDevice) => device.disconnect() })
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

  /**
   * Destroys a connection with the device.
   * @returns Disconnect promise.
   */
  @debounce({
    timeout(this: BluetoothDevice) {
      return this.options.idleTimeout ?? DEFAULT_TIMEOUT_IDLE;
    },
  })
  @retry({
    retries(this: BluetoothDevice) {
      return this.options.retries ?? DEFAULT_NUMBER_OF_RETRIES;
    },
  })
  @timeout({
    timeout(this: BluetoothDevice) {
      return this.options.timeout ?? DEFAULT_TIMEOUT;
    },
    reason: 'Disconnect timeout.',
  })
  disconnect(): PCancelable<void> {
    return new PCancelable((resolve, reject, onCancel) => {
      if (!this.peripheral || this.peripheral.state === 'disconnected') {
        resolve();

        return;
      }

      onCancel(() => this.peripheral?.removeListener('disconnect', resolve));
      this.peripheral?.disconnect(resolve);
    });
  }

  /**
   * Waits for the next notification.
   * If the device was not previously connected, the connection will be established automatically.
   * @param handle The notification handle.
   * @returns The notification data buffer.
   */
  @retry({
    retries(this: BluetoothDevice) {
      return this.options.retries ?? DEFAULT_NUMBER_OF_RETRIES;
    },
  })
  @before({ action: (device: BluetoothDevice) => device.connect(), wait: true })
  @timeout({
    timeout(this: BluetoothDevice) {
      return this.options.timeout ?? DEFAULT_TIMEOUT;
    },
    reason: 'Notify timeout.',
  })
  notify(handle: number): PCancelable<Buffer> {
    return new PCancelable((resolve, reject, onCancel) => {
      // eslint-disable-next-line no-use-before-define
      const unsubscribe = () => this.peripheral?.removeListener('handleNotify', onNotify);
      const onNotify = (notificationHandle: number, data: Buffer) => {
        if (notificationHandle !== handle) {
          return;
        }

        unsubscribe();
        resolve(data);
      };

      onCancel(unsubscribe);
      this.peripheral?.on('handleNotify', onNotify);
    });
  }
}
