Integrate GridSense Energy Management into your Homey ecosystem.

This app connects Homey to your GridSense gateway over your local network, so
your solar production, home battery and grid consumption all show up in Homey
Energy alongside the rest of your smart home.

Supported devices:

- GridSense Gateway
  Discovered automatically on your network. The gateway is the bridge between
  Homey and your installation, and is required before adding any other device.

- GridSense Inverter
  Live solar production and total energy produced.

- GridSense Home Battery
  Live charge and discharge power, state of charge, and total energy charged
  and discharged.

- GridSense Export+Import Meter
  Live grid power, plus cumulative energy imported from and exported to the
  grid.

Getting started:

1. Make sure your GridSense gateway is powered on and connected to the same
   network as your Homey.
2. In Homey, add the GridSense Gateway device. It should appear automatically.
3. Add your inverter, home battery and meter. They are read from the gateway,
   so no additional credentials are needed.

All communication stays on your local network. This app does not require a
GridSense cloud account and sends no data to external services.

Support and more information: https://gridsense.nl/
