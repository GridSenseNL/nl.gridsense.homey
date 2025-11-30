import Homey from 'homey';

import GridSenseApiClient, {
  EnergyMeterDescriptor,
} from '../../gridsense/GridSenseApiClient';

const trimNulls = (str: string): string =>
  str.replace(/\u0000+$/g, '').trim();

module.exports = class GridSenseGridMeterDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.log('GridSenseGridMeterDriver init');
  }

  async onPairListDevices() {
    const gatewayDriver = this.homey.drivers.getDriver('gridsense-gateway');
    const gatewayDevices = gatewayDriver.getDevices() as Homey.Device[];

    const devices = [];

    for (const gw of gatewayDevices) {
      const ip = (gw.getSetting('ipAddress') as string) || '';
      const port = (gw.getSetting('port') as number) || 3000;
      const gatewayUuid =
        (gw.getSetting('uuid') as string) || (gw.getData() as any).id;

      if (!ip) {
        this.homey.log(
          'Gateway has no IP, skipping in grid meter pairing:',
          gw.getName(),
        );
        continue;
      }

      const client = new GridSenseApiClient(ip, port);

      let meters: EnergyMeterDescriptor[];
      try {
        meters = await client.listImportExportMeters(gatewayUuid);
      } catch (err) {
        this.homey.error(
          'Failed to fetch energy meters from gateway',
          ip,
          err,
        );
        continue;
      }

      for (const desc of meters) {
        const m = desc.meter;

        const manufacturer = trimNulls(m.manufacturer);
        const model = trimNulls(m.model);
        const serial = trimNulls(m.serialNumber);

        const baseName =
          `${manufacturer} ${model}`.trim() || 'GridSense Export+Import Meter';
        const name =
          `${baseName} (${serial || ip})`.replace(/\s+/g, ' ').trim();

        const id = desc.meterId;

        devices.push({
          name,
          data: {
            id, // stable: manufacturer + serialNumber
          },
          settings: {
            ipAddress: ip,
            port,
            gatewayUuid,
            meterId: desc.meterId,
            serialNumber: serial,
          },
        });
      }
    }

    this.homey.log('Grid meters found for pairing:', devices);
    return devices;
  }
}
