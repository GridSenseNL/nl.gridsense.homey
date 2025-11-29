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
  totalEnergyCharged: string; // Wh (string)
  totalEnergyDischarged: string; // Wh (string)
}

export interface DevicesResponse {
  batteries?: {
    [groupId: string]: BatteryDevice[];
  };
  // later: inverters, evChargers, etc
}

export interface BatteryDescriptor {
  gatewayUuid: string;
  groupId: string;
  index: number;
  battery: BatteryDevice;
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

  /**
   * Helper to flatten all batteries for a given gateway.
   * You pass in gatewayUuid just so you can keep it with the result.
   */
  async listBatteries(gatewayUuid: string): Promise<BatteryDescriptor[]> {
    const devices = await this.getDevices();
    const result: BatteryDescriptor[] = [];

    const batteries = devices.batteries ?? {};
    for (const [groupId, arr] of Object.entries(batteries)) {
      arr.forEach((battery, index) => {
        result.push({
          gatewayUuid,
          groupId,
          index,
          battery,
        });
      });
    }

    return result;
  }
}
