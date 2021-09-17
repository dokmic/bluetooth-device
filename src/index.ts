import noble, { Peripheral } from '@abandonware/noble';
import { after, before, cancelable, debounce, onCancel, retry, semaphore, timeout } from 'ts-async-decorators';

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
  // eslint-disable-next-line no-useless-constructor
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
  @cancelable()
  async discover(): Promise<void> {
    if (this.peripheral) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
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

      onCancel(() => {
        stop();
        reject();
      });
      noble.on('discover', onDiscover);
      noble.on('stateChange', onStateChange);

      if (noble.state === 'poweredOn') {
        noble.startScanningAsync();
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
  @cancelable()
  async connect(): Promise<void> {
    if (this.peripheral?.state === 'connected') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onConnect = (error?: string) => (error ? reject(new Error(error)) : resolve());
      const onDisconnect = () => this.peripheral?.connect(onConnect);

      onCancel(() => {
        this.peripheral?.removeListener('connect', onConnect);
        this.peripheral?.removeListener('disconnect', onDisconnect);
        reject();
      });

      if (this.peripheral?.state === 'connecting') {
        this.peripheral?.once('connect', onConnect);

        return;
      }

      if (this.peripheral?.state === 'disconnecting') {
        this.peripheral?.once('disconnect', onDisconnect);

        return;
      }

      onDisconnect();
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
  @cancelable()
  async disconnect(): Promise<void> {
    if (!this.peripheral || this.peripheral.state === 'disconnected') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      onCancel(() => {
        this.peripheral?.removeListener('disconnect', resolve);
        reject();
      });
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
  @cancelable()
  notify(handle: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line no-use-before-define
      const unsubscribe = () => this.peripheral?.removeListener('handleNotify', onNotify);
      const onNotify = (notificationHandle: number, data: Buffer) => {
        if (notificationHandle !== handle) {
          return;
        }

        unsubscribe();
        resolve(data);
      };

      onCancel(() => {
        unsubscribe();
        reject();
      });
      this.peripheral?.on('handleNotify', onNotify);
    });
  }

  /**
   * Reads data from the device.
   * If the device was not previously connected, the connection will be established automatically.
   * @param handle The handle to read from.
   * @returns The data buffer.
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
    reason: 'Read timeout.',
  })
  @cancelable()
  read(handle: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const onRead = (error: string, data: Buffer) => (error ? reject(new Error(error)) : resolve(data));

      onCancel(() => {
        this.peripheral?.removeListener(`handleRead${handle}`, onRead);
        reject();
      });
      this.peripheral?.readHandle(handle as unknown as Buffer, onRead);
    });
  }

  /**
   * Writes data to the device.
   * If the device was not previously connected, the connection will be established automatically.
   * @param handle The write handle.
   * @param data The data buffer.
   * @returns Writing promise.
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
    reason: 'Write timeout.',
  })
  @cancelable()
  write(handle: number, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const onWrite = () => resolve();

      onCancel(() => {
        this.peripheral?.removeListener(`handleWrite${handle}`, onWrite);
        reject();
      });
      this.peripheral?.writeHandle(handle as unknown as Buffer, data, false, onWrite);
    });
  }
}
