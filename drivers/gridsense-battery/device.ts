import Homey from 'homey';
import GridSenseApiClient, {
  BatteryDevice,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseBatteryDevice extends Homey.Device {
  private client!: GridSenseApiClient;
  private batteryId!: string;
  private pollInterval?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.log('GridSenseBatteryDevice init');

    const ip = (this.getSetting('ipAddress') as string) || '';
    const port = (this.getSetting('port') as number) || 3000;
    this.batteryId = (this.getSetting('batteryId') as string) || '';

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  async onUninit(): Promise<void> {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }

  async onSettings({ newSettings }: {
    newSettings: Record<string, unknown>;
  }): Promise<void> {
    this.log('Battery settings updated', newSettings);

    const ip = (newSettings.ipAddress as string) || '';
    const port = (newSettings.port as number) || 3000;
    this.batteryId = (newSettings.batteryId as string) || this.batteryId;

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  private startPolling() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }

    this.poll().catch((err) => this.error('Initial poll error', err));

    this.pollInterval = this.homey.setInterval(
      () => {
        this.poll()
          .catch((err) => this.error('Poll error', err));
      },
      30_000,
    );
  }

  private async poll() {
    if (!this.batteryId) {
      this.log('No batteryId set, skipping poll');
      return;
    }

    const battery: BatteryDevice | null = await this.client.getBatteryById(this.batteryId);

    if (!battery) {
      this.log('Battery not found for id', this.batteryId);
      return;
    }

    // 1) Live power (W)
    await this.setCapabilityValue('measure_power', battery.powerDc);

    // 2) Lifetime energy (kWh)
    const chargedWh = parseFloat(battery.totalEnergyCharged);
    const dischargedWh = parseFloat(battery.totalEnergyDischarged);

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

    // Optional: SoE → measure_battery
    // const soePct = Math.round(battery.soe * 100);
  }
};
