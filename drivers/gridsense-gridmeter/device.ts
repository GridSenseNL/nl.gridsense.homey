import Homey from 'homey';

import GridSenseApiClient, {
  EnergyMeterDevice,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseGridMeterDevice extends Homey.Device {
  private client!: GridSenseApiClient;
  private meterId!: string;
  private pollInterval?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.log('GridSenseGridMeterDevice init');

    const ip = (this.getSetting('ipAddress') as string) || '';
    const port = (this.getSetting('port') as number) || 3000;
    this.meterId = (this.getSetting('meterId') as string) || '';

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  async onUninit(): Promise<void> {
    if (this.pollInterval) this.homey.clearInterval(this.pollInterval);
  }

  async onSettings({ newSettings }: {
    newSettings: Record<string, unknown>;
  }): Promise<void> {
    this.log('Grid meter settings updated', newSettings);

    const ip = (newSettings.ipAddress as string) || '';
    const port = (newSettings.port as number) || 3000;
    this.meterId = (newSettings.meterId as string) || this.meterId;

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  private startPolling() {
    if (this.pollInterval) this.homey.clearInterval(this.pollInterval);

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
    if (!this.meterId) {
      this.log('No meterId set, skipping poll');
      return;
    }

    const meter: EnergyMeterDevice | null = await this.client.getImportExportMeterById(this.meterId);

    if (!meter) {
      this.log('Energy meter not found for id', this.meterId);
      return;
    }

    // Live power:
    // powerAc < 0 → import; > 0 → export.
    // We keep the sign so advanced users can see direction.
    await this.setCapabilityValue('measure_power', -meter.powerAc);

    // Cumulative kWh:
    // totalImportAc / totalExportAc are assumed Wh → convert to kWh.
    const importedKwh = meter.totalImportAc / 1000;
    const exportedKwh = meter.totalExportAc / 1000;

    await this.setCapabilityValue(
      'meter_power.imported',
      importedKwh,
    );
    await this.setCapabilityValue(
      'meter_power.exported',
      exportedKwh,
    );
  }
};
