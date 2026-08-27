import Homey from 'homey';

import GridSenseApiClient, {
  EVChargerDescriptor,
  trimNulls,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseEvChargerDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.log('GridSenseEvChargerDriver init');
  }

  async onPairListDevices() {
    const gatewayDriver = this.homey.drivers.getDriver('gridsense-gateway');
    const gatewayDevices = gatewayDriver.getDevices() as Homey.Device[];

    const devices = [];

    for (const gw of gatewayDevices) {
      const ip = (gw.getSetting('ipAddress') as string) || '';
      const port = (gw.getSetting('port') as number) || 3000;
      const gatewayUuid = (gw.getSetting('uuid') as string) || (gw.getData() as { id?: string }).id || '';

      if (!ip) {
        this.homey.log(
          'Gateway has no IP, skipping in EV charger pairing:',
          gw.getName(),
        );
        continue;
      }

      const client = new GridSenseApiClient(ip, port);

      let evChargers: EVChargerDescriptor[];
      try {
        evChargers = await client.listEvChargers(gatewayUuid);
      } catch (err) {
        this.homey.error(
          'Failed to fetch EV chargers from gateway',
          ip,
          err,
        );
        continue;
      }

      for (const desc of evChargers) {
        const charger = desc.evCharger;

        const manufacturer = trimNulls(charger.manufacturer);
        const model = trimNulls(charger.model ?? '');
        const serial = trimNulls(charger.serialNumber);

        const baseName = `${manufacturer} ${model}`.trim() || 'GridSense EV Charger';
        const name = `${baseName} (${serial || ip})`.replace(/\s+/g, ' ').trim();

        const id = desc.evChargerId; // stabiel: manufacturer + serial

        devices.push({
          name,
          data: {
            id,
          },
          settings: {
            ipAddress: ip,
            port,
            gatewayUuid,
            evChargerId: desc.evChargerId,
            serialNumber: serial,
          },
        });
      }
    }

    this.homey.log('EV chargers found for pairing:', devices);
    return devices;
  }
};
