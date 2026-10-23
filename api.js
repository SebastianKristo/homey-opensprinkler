'use strict';

module.exports = {
  async getMeters({ homey }) { return homey.app.water.listMeters(); },
  async getStatus({ homey }) { return { ...homey.app.water.status(), valve: homey.app.valve.status() }; },
  async getValves({ homey }) { return homey.app.valve.listValves(); },
  async testValve({ homey }) { await homey.app.valve.turnOn(); return true; },
  async reset({ homey }) { await homey.app.water.reset(); return homey.app.water.status(); },
};
