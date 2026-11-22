// Leest de instellingen die je in Home Assistant bij de App invult.
import fs from 'node:fs';

const DEFAULTS = {
  groep_naam: '',
  tijdstip: '18:00',
  tijdzone: 'Europe/Brussels',
  melding_service: 'persistent_notification.create',
  bot_telefoonnummer: '',
  laatste_herlading: '',
  geldigheid_maanden: 9 // DIGI prepaid: 9 maanden na activatie of laatste herlading
};

export function loadConfig(file = process.env.PADELBOT_OPTIONS || '/data/options.json') {
  let options = {};
  if (fs.existsSync(file)) options = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...DEFAULTS, ...options };
}
