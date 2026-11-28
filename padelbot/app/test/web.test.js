// Statuspagina: ledenlijst tonen en namen opslaan.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Bot, formatPhone } from '../src/bot.js';
import { Store } from '../src/store.js';
import { startWeb } from '../src/web.js';

const silent = { info() {}, warn() {}, error() {} };

function makeBot() {
  const bot = new Bot({
    store: new Store(null),
    config: { tijdstip: '18:00', tijdzone: 'Europe/Brussels' },
    wa: { async sendText() {}, async sendPoll() { return { id: 'p', secret: 'ab' }; } },
    notify: async () => {},
    log: silent
  });
  return bot;
}

test('telefoonnummers netjes tonen', () => {
  assert.equal(formatPhone('32470123456'), '+32 470 12 34 56');
  assert.equal(formatPhone('31612345678'), '+31612345678');
});

test('namen instellen en weer wissen', async () => {
  const bot = makeBot();
  await bot.syncMembers([
    { ids: ['111@lid', '32470123456@s.whatsapp.net'] },
    { ids: ['222@lid', '32475987654@s.whatsapp.net'] }
  ]);
  bot.upsertPerson(['222@lid'], 'Elske 🌸');
  const [a, b] = ['111@lid', '222@lid'].map((id) => bot.findPerson([id]));
  assert.equal(bot.displayName(a), '+32470123456');
  assert.equal(bot.setNames({ [a]: ' Jan ', [b]: 'Els' }), 2);
  assert.equal(bot.displayName(a), 'Jan');
  assert.equal(bot.displayName(b), 'Els');
  bot.setNames({ [b]: '' });
  assert.equal(bot.displayName(b), 'Elske 🌸', 'leeg vakje = WhatsApp-profielnaam');
  assert.deepEqual(bot.memberList().map((m) => m.phone).sort(), ['+32 470 12 34 56', '+32 475 98 76 54']);
});

test('statuspagina: ledenlijst en opslaan via het formulier', async () => {
  const bot = makeBot();
  await bot.syncMembers([{ ids: ['111@lid', '32470123456@s.whatsapp.net'] }, { ids: ['333@lid'] }]);
  const wa = { status: { connection: 'verbonden', me: '+32487000000', group: 'Padel', error: null } };
  let ran = 0;
  const server = startWeb({ port: 0, wa, bot, config: { groep_naam: 'Padel', tijdstip: '18:00' }, log: silent, run: async (fn) => { ran += 1; return fn(); } });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const page = await (await fetch(url)).text();
    assert.match(page, /Leden van de groep/);
    assert.match(page, /\+32 470 12 34 56/);
    assert.match(page, /nummer onbekend/);
    assert.doesNotMatch(page, /http-equiv="refresh"/, 'niet verversen tijdens het invullen');

    const pid = bot.findPerson(['111@lid']);
    const body = new URLSearchParams({ [`naam:${pid}`]: 'Jan' });
    const saved = await (await fetch(url, { method: 'POST', body })).text();
    assert.match(saved, /Namen opgeslagen/);
    assert.match(saved, /value="Jan"/);
    assert.equal(bot.displayName(pid), 'Jan');
    assert.equal(ran, 1, 'opslaan loopt via de wachtrij van de bot');

    // Tijdens het koppelen wel verversen, en geen ledenlijst
    wa.status = { connection: 'wacht op koppeling', qr: null, error: null };
    const waiting = await (await fetch(url)).text();
    assert.match(waiting, /http-equiv="refresh"/);
    assert.doesNotMatch(waiting, /Leden van de groep/);
  } finally {
    server.close();
  }
});

test('statuspagina: stand aanpassen bij een lopende wedstrijd', async () => {
  const bot = makeBot();
  await bot.syncMembers([{ ids: ['a@lid'] }, { ids: ['b@lid'] }]);
  bot.setNames({ 'a@lid': 'Jan', 'b@lid': 'Els' });
  bot.state.matches['2026-12-02'] = { date: '2026-12-02', status: 'open', poll: { id: 'p', secret: 'ab' }, yesOrder: ['a@lid'], guests: [], votes: { 'a@lid': 'yes' }, flags: {}, team: null };
  const wa = { status: { connection: 'verbonden', me: '+32487000000', group: 'Padel', error: null } };
  const server = startWeb({ port: 0, wa, bot, config: { groep_naam: 'Padel', tijdstip: '18:00' }, log: silent });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const page = await (await fetch(url)).text();
    assert.match(page, /Stand aanpassen/);
    assert.match(page, /<option value="yes" selected>✅ Kan spelen/);
    const body = new URLSearchParams({ 'stem:a@lid': 'no', 'stem:b@lid': 'yes' });
    const saved = await (await fetch(url, { method: 'POST', body })).text();
    assert.match(saved, /Stand aangepast/);
    assert.doesNotMatch(saved, /Namen opgeslagen/);
    assert.deepEqual(bot.openMatch().yesOrder, ['b@lid']);
    assert.equal(bot.displayName('a@lid'), 'Jan', 'namen blijven ongewijzigd');
  } finally {
    server.close();
  }
});
