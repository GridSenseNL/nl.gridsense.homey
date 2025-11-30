// src/gridsense/GridSenseApiClient.ts

const trimNulls = (str: string): string =>
  str.replace(/\u0000+$/g, '').trim();

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
}
