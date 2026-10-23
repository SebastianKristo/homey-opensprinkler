'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

/**
 * Minimal client for the OpenSprinkler firmware HTTP API (2.1.x+).
 * See https://openthings.freshdesk.com/support/solutions/articles/5000716363
 */
class OpenSprinklerApi {

  constructor({ host, password, passwordIsHash = false }) {
    let base = String(host).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
    this.base = base;
    this.pw = passwordIsHash ? password : OpenSprinklerApi.hash(password || 'opendoor');
  }

  static hash(password) {
    return crypto.createHash('md5').update(String(password)).digest('hex');
  }

  _get(path, params = {}) {
    const url = new URL(`${this.base}/${path}`);
    url.searchParams.set('pw', this.pw);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const lib = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.get(url, { timeout: 10000, rejectUnauthorized: false }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          let json;
          try { json = JSON.parse(data); } catch (err) { return reject(new Error('Invalid response from controller')); }
          if (json && typeof json.result === 'number' && json.result !== 1) {
            return reject(new Error(OpenSprinklerApi.RESULT_ERRORS[json.result] || `Error code ${json.result}`));
          }
          return resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timeout connecting to controller')));
      req.on('error', reject);
    });
  }

  /** Fetches everything and normalises it into one state object. */
  async getState() {
    let all = null;
    try {
      all = await this._get('ja');
    } catch (err) {
      // Older firmware has no /ja; anything else (e.g. wrong password) is fatal.
      if (!/HTTP 404|Page not found|Invalid response/.test(err.message)) throw err;
    }
    if (!all || !all.settings || !all.options || !all.stations) {
      const [settings, options, stations, programs, status] = await Promise.all([
        this._get('jc'), this._get('jo'), this._get('jn'), this._get('jp'), this._get('js').catch(() => ({})),
      ]);
      all = { settings, options, stations, programs, status };
    }
    if (!all.settings || typeof all.settings.devt !== 'number') {
      throw new Error('Unexpected response – is this an OpenSprinkler controller?');
    }
    return OpenSprinklerApi.normalise(all);
  }

  static normalise({ settings, options = {}, stations = {}, programs = {}, status = {} }) {
    const now = settings.devt;
    const names = stations.snames || [];
    const bit = (arr, i) => Array.isArray(arr) && ((arr[i >> 3] >> (i & 7)) & 1) === 1;
    const progNames = (programs.pd || []).map((p, i) => p[5] || `Program ${i + 1}`);

    const zones = names.map((name, sid) => {
      const ps = (settings.ps && settings.ps[sid]) || [0, 0, 0];
      const running = status.sn ? status.sn[sid] === 1 : bit(settings.sbits, sid);
      const [pid, rem, start] = ps;
      const waiting = !running && pid > 0;
      let remaining = 0;
      if (running) remaining = rem;
      return {
        sid,
        name,
        running,
        waiting,
        disabled: bit(stations.stn_dis, sid),
        remaining,
        start,
        program: pid === 99 ? 'Manual' : pid === 254 ? 'Run-once' : pid > 0 ? progNames[pid - 1] || `Program ${pid}` : null,
        isMaster: options.mas === sid + 1 || options.mas2 === sid + 1,
      };
    });

    return {
      mac: settings.mac || null,
      firmware: options.fwv,
      enabled: settings.en === 1,
      rainDelay: settings.rd === 1,
      rainDelayEnd: settings.rd === 1 ? settings.rdst : 0,
      sensor1: settings.sn1 === 1,
      sensor2: settings.sn2 === 1,
      waterLevel: options.wl,
      flowRate: settings.flcrt,
      now,
      zones,
      programs: (programs.pd || []).map((p, i) => ({ pid: i, name: progNames[i], enabled: (p[0] & 1) === 1 })),
    };
  }

  runStation(sid, seconds) { return this._get('cm', { sid, en: 1, t: Math.max(1, Math.round(seconds)) }); }
  stopStation(sid) { return this._get('cm', { sid, en: 0 }); }
  stopAll() { return this._get('cv', { rsn: 1 }); }
  setEnabled(en) { return this._get('cv', { en: en ? 1 : 0 }); }
  setRainDelay(hours) { return this._get('cv', { rd: Math.max(0, Math.round(hours)) }); }
  setWaterLevel(pct) { return this._get('co', { wl: Math.max(0, Math.min(250, Math.round(pct))) }); }
  runProgram(pid, useWeather = false) { return this._get('mp', { pid, uwt: useWeather ? 1 : 0 }); }
  setProgramEnabled(pid, en) { return this._get('cp', { pid, en: en ? 1 : 0 }); }

}

OpenSprinklerApi.RESULT_ERRORS = {
  2: 'Unauthorized (wrong password)',
  3: 'Mismatch',
  16: 'Data missing',
  17: 'Out of range',
  18: 'Data format error',
  19: 'RF code error',
  32: 'Page not found',
  48: 'Not permitted',
};

module.exports = OpenSprinklerApi;
