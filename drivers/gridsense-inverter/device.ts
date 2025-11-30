import Homey from 'homey';

import GridSenseApiClient, {
  InverterDevice,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseInverterDevice extends Homey.Device {
  private client!: GridSenseApiClient;
  private inverterId!: string;
  private pollInterval?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.log('GridSenseInverterDevice init');

    const ip = (this.getSetting('ipAddress') as string) || '';
    const port = (this.getSetting('port') as number) || 3000;
    this.inverterId = (this.getSetting('inverterId') as string) || '';

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  async onUninit(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  async onSettings({ newSettings }: {
    newSettings: Record<string, unknown>;
  }): Promise<void> {
    this.log('Inverter settings updated', newSettings);

    const ip = (newSettings.ipAddress as string) || '';
    const port = (newSettings.port as number) || 3000;
    this.inverterId =
      (newSettings.inverterId as string) || this.inverterId;

    this.client = new GridSenseApiClient(ip, port);
    this.startPolling();
  }

  private startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.poll().catch((err) => this.error('Initial poll error', err));

    this.pollInterval = setInterval(
      () => this.poll().catch((err) => this.error('Poll error', err)),
      30_000,
    );
  }

  private async poll() {
    if (!this.inverterId) {
      this.log('No inverterId set, skipping poll');
      return;
    }

    const inv: InverterDevice | null = await this.client.getInverterById(this.inverterId);

    if (!inv) {
      this.log('Inverter not found for id', this.inverterId);
      return;
    }

    // powerAc in jouw data:
    // negatief = import / laden (bij hybrid), positief = injectie
    // Voor nu houden we het teken, zodat je dit zelf ziet.
    await this.setCapabilityValue('measure_power', inv.powerDcPvTotal);

    // totalEnergyInjected is Wh → kWh
    const injectedKwh = inv.totalPvProduction / 1000;
    await this.setCapabilityValue('meter_power', injectedKwh);

    // Later kun je temperatuur / status ook mappen naar extra capabilities
    // bv: measure_temperature, measure_voltage, etc.
  }
};
