'use strict';

const PATTERN = /^(S\d+)\s+(.+?)(?:\s*·\s*(Drypp|Spr|Spreder)\s*(B\d+))?$/i;

/** Parses OpenSprinkler station names like "S01 Garasje/Roser · Drypp B1". */
function parseZoneName(raw, index) {
  const m = PATTERN.exec(String(raw || '').trim());
  if (!m) return { id: `S${String(index + 1).padStart(2, '0')}`, name: raw, typeHint: null, valve: null };
  return { id: m[1], name: m[2], typeHint: m[3] ? (/^d/i.test(m[3]) ? 'drip' : 'spray') : null, valve: m[4] || null };
}

/** Guesses zone type from the station name. */
function guessType(raw) {
  if (/drypp|drip/i.test(raw)) return 'drip';
  if (/spr|spreder|spray|plen|lawn/i.test(raw)) return 'spray';
  return 'drip';
}

module.exports = { parseZoneName, guessType };
