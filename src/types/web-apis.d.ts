/**
 * Ambient declarations for the device APIs the remote drivers use.
 *
 * Neither WebHID nor Web Bluetooth is in TypeScript's bundled lib.dom.d.ts,
 * and both are optional at runtime, so they are declared here as narrowly as
 * this project actually needs.
 */

/* ------------------------------- WebHID -------------------------------- */

interface HIDReportItem {
  usagePage?: number;
  usages?: number[];
  reportCount?: number;
  reportSize?: number;
}

interface HIDReportInfo {
  reportId: number;
  items: HIDReportItem[];
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
  type?: number;
  children?: HIDCollectionInfo[];
  inputReports?: HIDReportInfo[];
  outputReports?: HIDReportInfo[];
  featureReports?: HIDReportInfo[];
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => void) | null;
  addEventListener(
    type: 'inputreport',
    listener: (ev: HIDInputReportEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: 'inputreport',
    listener: (ev: HIDInputReportEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[]; exclusionFilters?: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

/* --------------------------- Web Bluetooth ----------------------------- */

interface BluetoothCharacteristicProperties {
  readonly notify: boolean;
  readonly read: boolean;
  readonly write: boolean;
  readonly indicate: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  readValue(): Promise<DataView>;
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (ev: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  forget?(): Promise<void>;
}

interface RequestDeviceOptions {
  filters?: { services?: (string | number)[]; name?: string; namePrefix?: string }[];
  optionalServices?: (string | number)[];
  acceptAllDevices?: boolean;
}

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>;
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
}

interface Navigator {
  readonly hid?: HID;
  readonly bluetooth?: Bluetooth;
}
