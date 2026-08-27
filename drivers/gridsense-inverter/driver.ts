import Homey from 'homey';

import GridSenseApiClient, {
  InverterDescriptor,
  trimNulls,
} from '../../gridsense/GridSenseApiClient';

module.exports = class GridSenseInverterDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.log('GridSenseInverterDriver init');
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
          'Gateway has no IP, skipping in inverter pairing:',
          gw.getName(),
        );
        continue;
      }

      const client = new GridSenseApiClient(ip, port);

      let inverters: InverterDescriptor[];
      try {
        inverters = await client.listInverters(gatewayUuid);
      } catch (err) {
        this.homey.error(
          'Failed to fetch inverters from gateway',
          ip,
          err,
        );
        continue;
      }

      for (const desc of inverters) {
        const inv = desc.inverter;

        const manufacturer = trimNulls(inv.manufacturer);
        const model = trimNulls(inv.model);
        const serial = trimNulls(inv.serialNumber);

        const baseName = `${manufacturer} ${model}`.trim() || 'GridSense Inverter';
        const name = `${baseName} (${serial || ip})`.replace(/\s+/g, ' ').trim();

        const id = desc.inverterId; // stabiel: manufacturer + serial

        devices.push({
          name,
          data: {
            id,
          },
          settings: {
            ipAddress: ip,
            port,
            gatewayUuid,
            inverterId: desc.inverterId,
            serialNumber: serial,
          },
        });
      }
    }

    this.homey.log('Inverters found for pairing:', devices);
    return devices;
  }
};
