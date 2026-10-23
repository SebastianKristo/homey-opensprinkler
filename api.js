'use strict';

module.exports = {
  async getMeters({ homey }) { return homey.app.water.listMeters(); },
  async getStatus({ homey }) { return homey.app.water.status(); },
  async reset({ homey }) { await homey.app.water.reset(); return homey.app.water.status(); },
};
