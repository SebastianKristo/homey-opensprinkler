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

  /**
   * Fetches controller state. A full fetch (names, options, programs) is done when
   * `full` is set or nothing is cached; otherwise only the small /jc status is read.
   */
  async getState({ full = false } = {}) {
    if (full || !this._cache) {
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
      this._cache = { options: all.options, stations: all.stations, programs: all.programs };
      return OpenSprinklerApi.normalise(all);
    }
    const settings = await this._get('jc');
    if (typeof settings.devt !== 'number') throw new Error('Unexpected response – is this an OpenSprinkler controller?');
    // /jc has no per-station array; normalise() falls back to the sbits bitfield.
    return OpenSprinklerApi.normalise({ settings, ...this._cache, status: {} });
  }

  /** Forces the next getState() to do a full fetch (e.g. after changing options). */
  invalidate() {
    this._cache = null;
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
      programs: (programs.pd || []).map((p, i) => OpenSprinklerApi.parseProgram(p, i, progNames[i])),
    };
  }

  /** Decodes a raw /jp program entry. */
  static parseProgram(raw, pid, name) {
    const [flag = 0, days0 = 0, days1 = 0, starts = [], durations = [], , dateRange] = raw;
    const type = (flag >> 4) & 3;
    return {
      pid,
      name,
      enabled: (flag & 1) === 1,
      useWeather: ((flag >> 1) & 1) === 1,
      oddEven: (flag >> 2) & 3, // 0 none, 1 odd days, 2 even days
      scheduleType: type === 3 ? 'interval' : type === 0 ? 'weekly' : 'other',
      weekdays: type === 0 ? [0, 1, 2, 3, 4, 5, 6].filter(d => (days0 >> d) & 1) : [], // 0 = Monday
      interval: type === 3 ? days1 : null,
      remainder: type === 3 ? days0 : null,
      fixedStarts: ((flag >> 6) & 1) === 1,
      starts: ((flag >> 6) & 1) === 1 ? (starts || []).map(OpenSprinklerApi.decodeStart) : [OpenSprinklerApi.decodeStart((starts || [])[0])],
      repeat: ((flag >> 6) & 1) === 1 ? 0 : (starts || [])[1] || 0,
      repeatInterval: ((flag >> 6) & 1) === 1 ? 0 : (starts || [])[2] || 0,
      durations: durations || [],
      raw: { flag, days0, days1, dateRange: dateRange || null },
    };
  }

  /** Start time: minutes after midnight, or relative to sunrise/sunset (bits 14/13, sign bit 12). */
  static decodeStart(v) {
    if (v == null || v < 0) return null;
    const minutes = v & 0x7ff;
    const offset = (v >> 12) & 1 ? -minutes : minutes;
    if ((v >> 14) & 1) return { type: 'sunrise', offset };
    if ((v >> 13) & 1) return { type: 'sunset', offset };
    return { type: 'time', minutes };
  }

  static encodeStart(st) {
    if (!st) return -1;
    if (st.type === 'sunrise' || st.type === 'sunset') {
      const off = Math.max(-600, Math.min(600, Math.round(st.offset || 0)));
      return (1 << (st.type === 'sunrise' ? 14 : 13)) | (off < 0 ? 1 << 12 : 0) | Math.abs(off);
    }
    return Math.max(0, Math.min(1439, Math.round(st.minutes || 0)));
  }

  /**
   * Creates (pid = -1) or updates a program. `p` uses the format from parseProgram();
   * `today` is the controller's day number (devt / 86400), used for interval programs.
   */
  saveProgram(p, today = Math.floor(Date.now() / 86400000)) {
    const old = (p.raw && p.raw.flag) || 0;
    let flag = old & ~0x7f; // keep unknown high bits
    if (p.enabled) flag |= 1;
    if (p.useWeather) flag |= 2;
    flag |= ((p.oddEven || 0) & 3) << 2;
    let days0 = 0;
    let days1 = 0;
    if (p.scheduleType === 'interval') {
      flag |= 3 << 4;
      days1 = Math.max(1, Math.min(128, Math.round(p.interval || 1)));
      days0 = (today + Math.max(0, Math.round(p.startInDays || 0))) % days1;
    } else {
      for (const d of p.weekdays || []) days0 |= 1 << d;
    }
    let starts;
    if (p.fixedStarts) {
      flag |= 1 << 6;
      starts = [0, 1, 2, 3].map(i => OpenSprinklerApi.encodeStart((p.starts || [])[i]));
    } else {
      // Repeating: first start, number of repeats, interval in minutes.
      starts = [OpenSprinklerApi.encodeStart(p.starts && p.starts[0]), Math.max(0, Math.round(p.repeat || 0)),
        Math.max(1, Math.round(p.repeatInterval || 60)), -1];
    }
    const durations = (p.durations || []).map(d => Math.max(0, Math.round(d)));
    const params = {
      pid: p.pid == null ? -1 : p.pid,
      v: `[${flag},${days0},${days1},[${starts.join(',')}],[${durations.join(',')}]]`,
      name: String(p.name || 'Program').slice(0, 32),
    };
    const dr = p.raw && p.raw.dateRange;
    if (Array.isArray(dr) && dr.length === 3) Object.assign(params, { endr: dr[0], from: dr[1], to: dr[2] });
    this.invalidate();
    return this._get('cp', params);
  }

  deleteProgram(pid) {
    if (!(pid >= 0)) throw new Error('Invalid program'); // pid -1 would delete every program
    this.invalidate();
    return this._get('dp', { pid });
  }

  runStation(sid, seconds) { return this._get('cm', { sid, en: 1, t: Math.max(1, Math.round(seconds)) }); }
  stopStation(sid) { return this._get('cm', { sid, en: 0 }); }
  stopAll() { return this._get('cv', { rsn: 1 }); }
  setEnabled(en) { return this._get('cv', { en: en ? 1 : 0 }); }
  setRainDelay(hours) { return this._get('cv', { rd: Math.max(0, Math.round(hours)) }); }
  setWaterLevel(pct) { this.invalidate(); return this._get('co', { wl: Math.max(0, Math.min(250, Math.round(pct))) }); }
  runProgram(pid, useWeather = false) { return this._get('mp', { pid, uwt: useWeather ? 1 : 0 }); }
  setProgramEnabled(pid, en) { this.invalidate(); return this._get('cp', { pid, en: en ? 1 : 0 }); }

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
