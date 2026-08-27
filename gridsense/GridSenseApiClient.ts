// src/gridsense/GridSenseApiClient.ts

/**
 * Strings from the gateway are fixed-width fields padded with NUL bytes.
 */
// eslint-disable-next-line no-control-regex
export const trimNulls = (str: string): string => str.replace(/\u0000+$/g, '').trim();

export interface InverterDevice {
  manufacturer: string;
  model: string;
  serialNumber: string;
  version: string;
  status: number;
  vendorStatus: number;
  powerAc: number;
  currentAcL1?: number;
  currentAcL2?: number;
  currentAcL3?: number;
  voltageAcL1?: number;
  voltageAcL2?: number;
  voltageAcL3?: number;
  voltageAcL1L2?: number;
  frequency: number;
  powerApparentAc: number;
  powerReactiveAc: number;
  powerFactorL1?: number;
  powerFactorL2?: number;
  powerFactorL3?: number;
  powerDc: number;
  powerDcPvTotal: number;
  temperature: number;
  maxChargePower?: number;
  maxDischargePower?: number;
  totalPvProduction: number; // Wh
  totalEnergyInjected: number; // Wh
  powerDcPvSE: number;
  energyHandlingMode?: string; // free-form identifier, new values can appear at any time
}

export interface BatteryDevice {
  manufacturer: string;
  model: string;
  version: string;
  serialNumber: string;
  status: number;
  vendorStatus: number;
  powerDc: number;
  voltageDc: number;
  soh: number;
  soe: number; // 0..1
  temperature: number;
  temperatureMax: number;
  ratedEnergy: number;
  maximumEnergy: number;
  availableEnergy: number;
  maxChargeContinuousPower: number;
  maxDischargeContinuousPower: number;
  totalEnergyCharged: string;
  totalEnergyDischarged: string;
}

export interface EnergyMeterDevice {
  manufacturer: string;
  model: string;
  serialNumber: string;
  version: string;
  options: string; // contains "Export+Import\u0000..."
  powerAc: number;
  powerAcL1: number;
  powerAcL2: number;
  powerAcL3: number;
  voltageAcL1: number;
  voltageAcL2: number;
  voltageAcL3: number;
  currentAcL1: number;
  currentAcL2: number;
  currentAcL3: number;
  frequency: number;
  powerApparentAcL1: number;
  powerApparentAcL2: number;
  powerApparentAcL3: number;
  powerReactiveAcL1: number;
  powerReactiveAcL2: number;
  powerReactiveAcL3: number;
  powerFactorL1: number;
  powerFactorL2: number;
  powerFactorL3: number;
  totalExportAc: number; // Wh
  totalImportAc: number; // Wh
}

/**
 * Mirrors `EVChargerData` in the gateway firmware (src/devices/ev-charger/BaseEVCharger.ts).
 *
 * Almost every field is optional: the gateway supports several charger brands over
 * Modbus and each one exposes a different subset of registers.
 *
 * The energy counters are typed `number | string` on purpose. The gateway reads some
 * of them as 64-bit values and serialises `bigint` via `BigInt.prototype.toJSON`,
 * which turns them into strings on the wire.
 */
export interface EVChargerDevice {
  manufacturer: string;
  model?: string | null;
  serialNumber: string;
  version?: string | number | null;
  portIdentifier?: string | null;

  status?: number | null;
  vendorStatus?: number | null;
  vendorStatusString?: string | null;
  vehicleConnected?: boolean | null;
  lastWrittenCurrent?: number | null; // A

  powerAc?: number | null; // W
  powerAcL1?: number | null;
  powerAcL2?: number | null;
  powerAcL3?: number | null;
  voltageAcL1?: number | null;
  voltageAcL2?: number | null;
  voltageAcL3?: number | null;
  currentAcL1?: number | null;
  currentAcL2?: number | null;
  currentAcL3?: number | null;
  frequency?: number | null;

  temperature?: number | null;

  totalEnergyCharged?: number | string | null; // Wh
  dailyEnergyCharged?: number | string | null; // Wh
  currentSessionEnergyCharged?: number | string | null; // Wh
}

export interface DevicesResponse {
  inverters?: {
    [groupId: string]: InverterDevice
  };
  batteries?: {
    [groupId: string]: BatteryDevice[];
  };
  energyMeters?: {
    [groupId: string]: EnergyMeterDevice[];
  };
  evChargers?: {
    [key: string]: EVChargerDevice;
  };
}

export interface InverterDescriptor {
  gatewayUuid: string;
  inverterId: string; // `${manufacturer} ${serialNumber}`
  key: string; // de key in het inverters object (ec5a..., d818...)
  inverter: InverterDevice;
}

export interface BatteryDescriptor {
  gatewayUuid: string;
  batteryId: string; // `${manufacturer} ${serialNumber}`
  groupId: string;
  index: number;
  battery: BatteryDevice;
}

export interface EnergyMeterDescriptor {
  gatewayUuid: string;
  meterId: string; // `${manufacturer} ${serialNumber}`
  groupId: string;
  index: number;
  meter: EnergyMeterDevice;
}

export interface EVChargerDescriptor {
  gatewayUuid: string;
  evChargerId: string; // `${manufacturer} ${serialNumber}`
  key: string; // de key in het evChargers object (de device uuid van de gateway)
  evCharger: EVChargerDevice;
}

export default class GridSenseApiClient {
  private readonly baseUrl: string;

  constructor(ip: string, port: number = 3000) {
    this.baseUrl = `http://${ip}:${port}`;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `GridSenseApiClient: ${res.status} ${res.statusText} for ${url}`,
      );
    }

    return (await res.json()) as T;
  }

  async getDevices(): Promise<DevicesResponse> {
    return this.requestJson<DevicesResponse>('/api/v1/devices');
  }

  // ---------- Inverters ----------

  async listInverters(gatewayUuid: string): Promise<InverterDescriptor[]> {
    const devices = await this.getDevices();
    const result: InverterDescriptor[] = [];

    const inverters = devices.inverters ?? {};
    for (const [key, inv] of Object.entries(inverters)) {
      const manufacturer = trimNulls(inv.manufacturer);
      const serial = trimNulls(inv.serialNumber);
      const inverterId = `${manufacturer} ${serial}`.trim();

      result.push({
        gatewayUuid,
        inverterId,
        key,
        inverter: inv,
      });
    }

    return result;
  }

  async getInverterById(inverterId: string): Promise<InverterDevice | null> {
    const devices = await this.getDevices();
    const inverters = devices.inverters ?? {};

    for (const [, inv] of Object.entries(inverters)) {
      const manufacturer = trimNulls(inv.manufacturer);
      const serial = trimNulls(inv.serialNumber);
      const currentId = `${manufacturer} ${serial}`.trim();

      if (currentId === inverterId) {
        return inv;
      }
    }

    return null;
  }

  // ---------- Batteries ----------

  async listBatteries(gatewayUuid: string): Promise<BatteryDescriptor[]> {
    const devices = await this.getDevices();
    const result: BatteryDescriptor[] = [];

    const batteries = devices.batteries ?? {};
    for (const [groupId, arr] of Object.entries(batteries)) {
      arr.forEach((battery, index) => {
        const manufacturer = trimNulls(battery.manufacturer);
        const serial = trimNulls(battery.serialNumber);
        const batteryId = `${manufacturer} ${serial}`.trim();

        result.push({
          gatewayUuid,
          batteryId,
          groupId,
          index,
          battery,
        });
      });
    }

    return result;
  }

  async getBatteryById(batteryId: string): Promise<BatteryDevice | null> {
    const devices = await this.getDevices();
    const batteries = devices.batteries ?? {};

    for (const [, arr] of Object.entries(batteries)) {
      for (const battery of arr) {
        const manufacturer = trimNulls(battery.manufacturer);
        const serial = trimNulls(battery.serialNumber);
        const currentId = `${manufacturer} ${serial}`.trim();

        if (currentId === batteryId) return battery;
      }
    }

    return null;
  }

  // ---------- Energy Meters (Export+Import) ----------

  async listImportExportMeters(
    gatewayUuid: string,
  ): Promise<EnergyMeterDescriptor[]> {
    const devices = await this.getDevices();
    const result: EnergyMeterDescriptor[] = [];

    const meters = devices.energyMeters ?? {};
    for (const [groupId, arr] of Object.entries(meters)) {
      arr.forEach((meter, index) => {
        const options = trimNulls(meter.options);
        if (options !== 'Export+Import') return; // filter

        const manufacturer = trimNulls(meter.manufacturer);
        const serial = trimNulls(meter.serialNumber);
        const meterId = `${manufacturer} ${serial}`.trim();

        result.push({
          gatewayUuid,
          meterId,
          groupId,
          index,
          meter,
        });
      });
    }

    return result;
  }

  async getImportExportMeterById(
    meterId: string,
  ): Promise<EnergyMeterDevice | null> {
    const devices = await this.getDevices();
    const meters = devices.energyMeters ?? {};

    for (const [, arr] of Object.entries(meters)) {
      for (const meter of arr) {
        const manufacturer = trimNulls(meter.manufacturer);
        const serial = trimNulls(meter.serialNumber);
        const currentId = `${manufacturer} ${serial}`.trim();

        const options = trimNulls(meter.options);
        if (options !== 'Export+Import') continue;

        if (currentId === meterId) return meter;
      }
    }

    return null;
  }

  // ---------- EV Chargers ----------

  async listEvChargers(gatewayUuid: string): Promise<EVChargerDescriptor[]> {
    const devices = await this.getDevices();
    const result: EVChargerDescriptor[] = [];

    const evChargers = devices.evChargers ?? {};
    for (const [key, evCharger] of Object.entries(evChargers)) {
      const manufacturer = trimNulls(evCharger.manufacturer);
      const serial = trimNulls(evCharger.serialNumber);
      const evChargerId = `${manufacturer} ${serial}`.trim();

      result.push({
        gatewayUuid,
        evChargerId,
        key,
        evCharger,
      });
    }

    return result;
  }

  async getEvChargerById(evChargerId: string): Promise<EVChargerDevice | null> {
    const devices = await this.getDevices();
    const evChargers = devices.evChargers ?? {};

    for (const [, evCharger] of Object.entries(evChargers)) {
      const manufacturer = trimNulls(evCharger.manufacturer);
      const serial = trimNulls(evCharger.serialNumber);
      const currentId = `${manufacturer} ${serial}`.trim();

      if (currentId === evChargerId) {
        return evCharger;
      }
    }

    return null;
  }
}
