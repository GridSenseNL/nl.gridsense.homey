'use strict';

import Homey from 'homey';
import { Log } from 'homey-log';

module.exports = class MyApp extends Homey.App {

  homeyLog?: Log;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    // Report uncaught exceptions and unhandled rejections to Sentry. Events are not sent
    // while running `homey app run`, unless `HOMEY_LOG_FORCE` is set to `1` in env.json.
    // The homey-log typings declare `homey` as the `homey` module namespace rather than the
    // `Homey` instance; at runtime only `homey.version` and `homey.cloud` are read.
    this.homeyLog = new Log({ homey: this.homey as unknown as typeof Homey });

    this.log('GridSense has been initialized');
  }

};
