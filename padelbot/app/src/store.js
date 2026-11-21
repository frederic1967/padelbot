// Bewaart de toestand van de bot als JSON-bestand in /data (zit in de HA-back-ups).
import fs from 'node:fs';
import path from 'node:path';

export function emptyState() {
  return {
    version: 1,
    groupJid: null,
    people: {},   // id -> { ids: [...], name, customName, active }
    matches: {},  // 'YYYY-MM-DD' -> match
    topup: { sent: {} }
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = emptyState();
    if (file && fs.existsSync(file)) {
      this.state = { ...emptyState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file); // atomair: nooit een half geschreven bestand
  }
}
