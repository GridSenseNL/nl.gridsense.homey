import Homey from 'homey';

import GridSenseApiClient, {
  EVChargerDevice,
} from '../../gridsense/GridSenseApiClient';

/**
 * Chargers draw a few watts while idle, so anything below this is not a car
 * actually charging.
 */
const CHARGING_POWER_THRESHOLD_W = 50;

/**
 * The gateway serialises 64-bit counters as strings (BigInt.prototype.toJSON),
 * so every numeric field can arrive as either a number or a string.
 */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Maps the gateway's charger data onto Homey's `evcharger_charging_state` enum.
 * Returns null when the charger reports too little to tell, so we leave the
 * previous value alone instead of guessing.
 */
function toChargingState(charger: EVChargerDevice): string | null {
  const powerAc = toNumber(charger.powerAc);
  const isCharging = powerAc !== null && powerAc > CHARGING_POWER_THRESHOLD_W;

  // Not every brand exposes the cable state, so vehicleConnected can be absent.
  if (charger.vehicleConnected !== true && charger.vehicleConnected !== false) {
    return isCharging ? 'plugged_in_charging' : null;
  }

  if (charger.vehicleConnected === false) return 'plugged_out';

  if (isCharging) return 'plugged_in_charging';

  // The gateway writes 0 A when it deliberately holds the session, e.g. the
  // ALWAYS_OFF mode or dynamic load balancing throttling down to nothing.
  if (charger.lastWrittenCurrent === 0) return 'plugged_in_paused';

  return 'plugged_in';
}

module.exports = class GridSenseEvChargerDevice extends Homey.Device {
  private client!: GridSenseApiClient;
  private evChargerId!: string;
  private pollInterval?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.log('GridSenseEvChargerDevice init');

    const ip = (this.getSetting('ipAddress') as string) || '';
    const port = (this.getSetting('port') as number) || 3000;
    this.evChargerId = (this.getSetting('evChargerId') as string) || '';

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
    this.log('EV charger settings updated', newSettings);

    const ip = (newSettings.ipAddress as string) || '';
    const port = (newSettings.port as number) || 3000;
    this.evChargerId = (newSettings.evChargerId as string) || this.evChargerId;

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

  /**
   * Only expose a capability when this particular charger reports it: the
   * supported brands each read a different subset of Modbus registers.
   */
  private async syncOptionalCapability(
    capabilityId: string,
    isReported: boolean,
  ): Promise<void> {
    const hasCapability = this.hasCapability(capabilityId);

    if (isReported && !hasCapability) {
      await this.addCapability(capabilityId);
    } else if (!isReported && hasCapability) {
      await this.removeCapability(capabilityId);
    }
  }

  private async poll() {
    if (!this.evChargerId) {
      this.log('No evChargerId set, skipping poll');
      return;
    }

    const charger = await this.client.getEvChargerById(this.evChargerId);

    if (!charger) {
      this.log('EV charger not found for id', this.evChargerId);
      return;
    }

    // 1) Live power (W). Drives the live bar in Homey Energy.
    const powerAc = toNumber(charger.powerAc);
    if (powerAc !== null) {
      await this.setCapabilityValue('measure_power', powerAc);
    }

    // 2) Lifetime energy charged (Wh -> kWh). Homey Energy uses meter_power
    //    for the EV charger totals, as configured via energy.evCharger.
    const totalChargedWh = toNumber(charger.totalEnergyCharged);
    if (totalChargedWh !== null) {
      await this.setCapabilityValue('meter_power', totalChargedWh / 1000);
    }

    // 3) Charging state, so the user can act on "EV is plugged in".
    const chargingState = toChargingState(charger);
    if (chargingState !== null) {
      await this.setCapabilityValue('evcharger_charging_state', chargingState);
    }

    // 4) Optional extras, only for chargers that report them.
    const sessionChargedWh = toNumber(charger.currentSessionEnergyCharged);
    await this.syncOptionalCapability(
      'meter_power.session',
      sessionChargedWh !== null,
    );
    if (sessionChargedWh !== null) {
      await this.setCapabilityValue(
        'meter_power.session',
        sessionChargedWh / 1000,
      );
    }

    const temperature = toNumber(charger.temperature);
    await this.syncOptionalCapability(
      'measure_temperature',
      temperature !== null,
    );
    if (temperature !== null) {
      await this.setCapabilityValue('measure_temperature', temperature);
    }
  }
};
