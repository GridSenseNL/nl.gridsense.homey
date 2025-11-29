// src/drivers/gridsense-battery/device.ts
import Homey from 'homey';
import GridSenseApiClient, {
  DevicesResponse,
  BatteryDevice,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseBatteryDevice extends Homey.Device {
  private client!: GridSenseApiClient;
  private deviceGroupId!: string;
  private batteryIndex!: number;
  private pollInterval?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.log('GridSenseBatteryDevice init');

    const ip = (this.getSetting('ipAddress') as string) || '';
    const port = (this.getSetting('port') as number) || 3000;
    this.deviceGroupId = (this.getSetting('deviceGroupId') as string) || '';
    this.batteryIndex = (this.getSetting('batteryIndex') as number) || 0;

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  async onUninit(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  async onSettings({ newSettings }: {
    newSettings: {
        ipAddress?: string;
        port?: number;
        deviceGroupId?: string;
        batteryIndex?: number;
    }
  }): Promise<void> {
    this.log('Battery settings updated', newSettings);

    const ip = (newSettings.ipAddress as string) || '';
    const port = (newSettings.port as number) || 3000;
    this.deviceGroupId =
      (newSettings.deviceGroupId as string) || this.deviceGroupId;
    this.batteryIndex =
      (newSettings.batteryIndex as number) || this.batteryIndex;

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  private startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    // first run immediately
    this.poll().catch((err) => this.error('Initial poll error', err));

    this.pollInterval = setInterval(
      () => {
        this.poll()
          .catch((err) => this.error('Poll error', err));
      },
      30_000,
    );
  }

  private async poll() {
    if (!this.deviceGroupId) {
      this.log('No deviceGroupId set for battery, skipping poll');
      return;
    }

    const devices: DevicesResponse = await this.client.getDevices();
    const group = devices.batteries?.[this.deviceGroupId];

    if (!group || !group[this.batteryIndex]) {
      this.log(
        'Battery not found in devices response',
        this.deviceGroupId,
        this.batteryIndex,
      );
      return;
    }

    const b: BatteryDevice = group[this.batteryIndex];

    // 1) Live power (W) — Homey expects W for measure_power
    await this.setCapabilityValue('measure_power', b.powerDc);

    // 2) Lifetime energy — Homey expects kWh
    // Assumption: totalEnergyCharged / Discharged are Wh → convert to kWh.
    const chargedWh = parseFloat(b.totalEnergyCharged);
    const dischargedWh = parseFloat(b.totalEnergyDischarged);

    if (!Number.isNaN(chargedWh)) {
      await this.setCapabilityValue(
        'meter_power.imported',
        chargedWh / 1000,
      );
    }

    if (!Number.isNaN(dischargedWh)) {
      await this.setCapabilityValue(
        'meter_power.exported',
        dischargedWh / 1000,
      );
    }

    // Optional: you can later map b.soe (0..1) to a custom capability or measure_battery
    // const soePct = Math.round(b.soe * 100);
  }
}
