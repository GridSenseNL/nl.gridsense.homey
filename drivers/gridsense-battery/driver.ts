import Homey from 'homey';
import GridSenseApiClient, {
  BatteryDescriptor,
} from '../../gridsense/GridSenseApiClient';

function trimNulls(str: string): string {
  return str.replace(/\u0000+$/g, '').trim();
}

module.exports = class GridSenseBatteryDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.log('GridSenseBatteryDriver init');
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
          'Gateway has no IP, skipping in battery pairing:',
          gw.getName(),
        );
        continue;
      }

      const client = new GridSenseApiClient(ip, port);

      let batteries: BatteryDescriptor[];
      try {
        batteries = await client.listBatteries(gatewayUuid);
      } catch (err) {
        this.homey.error(
          'Failed to fetch batteries from gateway',
          ip,
          err,
        );
        continue;
      }

      for (const desc of batteries) {
        const b = desc.battery;

        const manufacturer = trimNulls(b.manufacturer);
        const model = trimNulls(b.model);
        const serial = trimNulls(b.serialNumber);

        const defaultName =
          `${manufacturer} ${model}`.trim() || 'GridSense Battery';

        const name =
          `${defaultName} (${serial || ip})`.replace(/\s+/g, ' ').trim();

        const id = `${gatewayUuid}:battery:${desc.groupId}:${desc.index}`;

        devices.push({
          name,
          data: {
            id,
          },
          settings: {
            ipAddress: ip,
            port,
            gatewayUuid,
            deviceGroupId: desc.groupId,
            batteryIndex: desc.index,
            serialNumber: serial,
          },
        });
      }
    }

    this.homey.log('Battery devices found for pairing:', devices);
    return devices;
  }
}
