'use strict';

const Homey = require('homey');
const WaterTracker = require('./lib/WaterTracker');

module.exports = class OpenSprinklerApp extends Homey.App {

  async onInit() {
    this._registerFlow();
    this._registerWidgets();
    this.water = new WaterTracker(this);
    // Give devices a moment to initialise before attaching to the meter.
    this.homey.setTimeout(() => this.water.start().catch(err => this.error('Water tracker:', err.message)), 5000);
    this.log('OpenSprinkler app started');
  }

  getControllers() {
    return this.homey.drivers.getDriver('controller').getDevices();
  }

  getController(id) {
    const all = this.getControllers();
    if (!id) return all[0];
    return all.find(d => d.getData().id === id);
  }

  _controllerAutocomplete(query) {
    const q = (query || '').toLowerCase();
    return this.getControllers()
      .map(d => ({ id: d.getData().id, name: d.getName() }))
      .filter(c => c.name.toLowerCase().includes(q));
  }

  _registerWidgets() {
    for (const id of ['zones', 'controller']) {
      try {
        this.homey.dashboards.getWidget(id)
          .registerSettingAutocompleteListener('controller', async query => this._controllerAutocomplete(query));
      } catch (err) {
        this.error(`Widget ${id} not available`, err.message);
      }
    }
  }

  _registerFlow() {
    const cards = this.homey.flow;

    cards.getActionCard('run_station').registerRunListener(({ device, minutes }) => device.run(minutes * 60));
    cards.getActionCard('stop_station').registerRunListener(({ device }) => device.stop());
    cards.getActionCard('stop_all').registerRunListener(({ device }) => device.api.stopAll().then(() => device.refresh()));
    cards.getActionCard('set_rain_delay').registerRunListener(({ device, hours }) => device.api.setRainDelay(hours).then(() => device.refresh()));
    cards.getActionCard('set_water_level').registerRunListener(({ device, level }) => device.api.setWaterLevel(level).then(() => device.refresh()));

    const programAutocomplete = async (query, { device }) => {
      const q = (query || '').toLowerCase();
      return ((device.state && device.state.programs) || [])
        .map(p => ({ id: p.pid, name: p.name, description: p.enabled ? '' : 'Disabled' }))
        .filter(p => p.name.toLowerCase().includes(q));
    };

    cards.getActionCard('run_program')
      .registerRunListener(({ device, program, use_weather: uwt }) => device.api.runProgram(program.id, uwt === 'yes').then(() => device.refresh()))
      .registerArgumentAutocompleteListener('program', programAutocomplete);

    cards.getActionCard('set_program_enabled')
      .registerRunListener(({ device, program, state }) => device.api.setProgramEnabled(program.id, state === 'on').then(() => device.refresh()))
      .registerArgumentAutocompleteListener('program', programAutocomplete);

    cards.getActionCard('reset_water').registerRunListener(() => this.water.reset());

    cards.getConditionCard('station_running').registerRunListener(({ device }) => device.getCapabilityValue('onoff') === true);
    cards.getConditionCard('rain_delay_active').registerRunListener(({ device }) => device.getCapabilityValue('os_rain_delay') === true);
  }

};
