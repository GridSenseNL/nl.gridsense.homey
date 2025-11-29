import Homey from 'homey';

module.exports = class GridSenseGatewayDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.log('GridSenseGatewayDriver init (using Homey Discovery)');
  }

  async onPairListDevices() {
    const discoveryStrategy = this.getDiscoveryStrategy();

    const discoveryResults = discoveryStrategy.getDiscoveryResults();
    this.homey.log('Discovery results', JSON.stringify(discoveryResults, null, 2));

    // discoveryResults is an object: { [id]: DiscoveryResultMDNSSD }
    const devices = Object.values(discoveryResults).map(
      (res: any) => {
        // res.address: IP address
        // res.port: port (3000)
        // res.txt: TXT values, lowercased: { uuid, description, ... }

        const uuid = res.txt?.uuid as string | undefined;
        const name = `GridSense Gateway (${uuid?.slice(0, 8)})`;

        return {
          name,
          data: {
            id: uuid, // unique device id
          },
          settings: {
            ipAddress: res.address,
            port: res.port,
            uuid: uuid ?? res.id,
          },
        };
      },
    );

    this.homey.log('Pair devices list', devices);
    return devices;
  }

};
