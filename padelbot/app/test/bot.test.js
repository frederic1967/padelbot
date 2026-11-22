import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Bot, NO, YES } from '../src/bot.js';
import { Store } from '../src/store.js';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const silent = { info() {}, warn() {}, error() {} };

/** Testopstelling: nep-WhatsApp, verstelbare klok (lokale tijd Brussel, winteruur). */
function setup({ start = '2026-11-23T18:00', herlading = '', testmodus = false } = {}) {
  const sent = [];
  const notes = [];
  let pollNr = 0;
  let now = toUtc(start);
  const wa = {
    async sendText(t) { sent.push(t); },
    async sendPoll(q, opts) { pollNr += 1; sent.push(`POLL ${q} [${opts.join('|')}]`); return { id: `poll${pollNr}`, secret: 'ab' }; }
  };
  const bot = new Bot({
    store: new Store(null),
    config: { tijdstip: '18:00', tijdzone: 'Europe/Brussels', laatste_herlading: herlading, testmodus },
    wa,
    notify: async (t, m) => { notes.push(`${t}: ${m}`); },
    clock: () => now,
    log: silent
  });
  const t = {
    bot, sent, notes,
    at(local) { now = toUtc(local); },
    take() { return sent.splice(0, sent.length); },
    async members(names) {
      await bot.syncMembers(names.map((n) => ({ ids: [`${n}@s.whatsapp.net`] })));
      for (const n of names) bot.upsertPerson([`${n}@s.whatsapp.net`], n);
    },
    pid(name) { return bot.findPerson([`${name}@s.whatsapp.net`]); },
    vote(name, yes, pollId) {
      const match = bot.openMatch();
      return bot.handleVote({
        pollId: pollId || match.poll.id,
        senderIds: [`${name}@s.whatsapp.net`],
        pushName: name,
        selectedHashes: yes === null ? [] : [hash(yes ? YES : NO)]
      });
    },
    cmd(name, text) { return bot.handleCommand({ senderIds: [`${name}@s.whatsapp.net`], pushName: name, text }); }
  };
  return t;
}

// Winteruur: Brussel = UTC+1
function toUtc(local) { return new Date(`${local}:00+01:00`); }

test('volledig verloop van een speeldag (goedgekeurd scenario)', async () => {
  const t = setup({ start: '2026-11-23T17:59' });
  await t.members(['Frederic', 'Jan', 'Els', 'Tom', 'Piet', 'An']);
  // Twee vroegere wedstrijden voor het overzicht
  t.bot.state.matches['2026-11-04'] = { date: '2026-11-04', status: 'played', team: { members: ['Frederic', 'Jan', 'Els', 'Tom'].map(t.pid), guests: [] } };
  t.bot.state.matches['2026-11-18'] = { date: '2026-11-18', status: 'played', team: { members: ['Frederic', 'Jan', 'Piet', 'An'].map(t.pid), guests: [] } };

  await t.bot.tick();
  assert.equal(t.take().length, 0, 'nog niets vóór 18:00');

  // Maandag 23 november 18:00: aankondiging
  t.at('2026-11-23T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), [
    '🎾 Onze volgende wedstrijd is op woensdag 2 december.\nWelke vier spelers kunnen er spelen?\n\n' +
    'Aantal keer meegespeeld (vorige 2 wedstrijden):\n• An: 1\n• Els: 1\n• Piet: 1\n• Tom: 1\n• Frederic: 2\n• Jan: 2',
    `POLL Kan jij spelen op woensdag 2 december? [${YES}|${NO}]`
  ]);
  await t.bot.tick();
  assert.equal(t.take().length, 0, 'niets dubbel');

  // Eén regel per stem
  await t.vote('Jan', true);
  await t.vote('Els', true);
  await t.vote('An', false);
  await t.vote('Tom', true);
  assert.deepEqual(t.take(), [
    '✅ Jan kan spelen (1/4)',
    '✅ Els kan spelen (2/4)',
    '❌ An kan niet',
    '✅ Tom kan spelen (3/4)'
  ]);
  await t.vote('Tom', true);
  assert.equal(t.take().length, 0, 'dezelfde stem opnieuw: geen bericht');

  // Dinsdag 24 november 18:00: team niet volledig → stand
  t.at('2026-11-24T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), [
    '⚠️ Voor woensdag 2 december ontbreekt nog 1 speler. Wie kan er nog? Stem in de peiling hierboven, of voeg een gast toe met !gast naam.\n\n' +
    '📋 Stand voor woensdag 2 december\n' +
    '✅ Speelt: Jan, Els en Tom (nog 1 nodig)\n' +
    '🔁 Reserve: –\n' +
    '❌ Kan niet: An\n' +
    '❓ Nog niet geantwoord: Frederic en Piet'
  ]);

  // De 4e speler: meteen de bevestiging, in één bericht
  await t.vote('Piet', true);
  assert.deepEqual(t.take(), ['✅ Piet kan spelen (4/4) – het team voor woensdag 2 december staat vast: Jan, Els, Tom en Piet.']);
  await t.vote('Frederic', true);
  assert.deepEqual(t.take(), ['✅ Frederic kan spelen – 1e reserve']);

  // Woensdag, donderdag: niets meer
  for (const day of ['2026-11-25T18:00', '2026-11-26T18:00', '2026-11-27T18:00']) {
    t.at(day);
    await t.bot.tick();
  }
  assert.equal(t.take().length, 0, 'geen herinneringen na dinsdag');

  // Iemand haakt af, de reserve schuift door
  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['❌ Els kan niet meer – Frederic speelt mee']);

  assert.equal(await t.cmd('Tom', '!status'),
    '📋 Stand voor woensdag 2 december\n✅ Speelt: Jan, Tom, Piet en Frederic\n🔁 Reserve: –\n❌ Kan niet: Els en An\n❓ Nog niet geantwoord: –');

  // Dinsdag 1 december 18:00: herhaling
  t.at('2026-12-01T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), ['🎾 Morgen padel! Op woensdag 2 december spelen: Jan, Tom, Piet en Frederic.']);

  // Speeldag 23:00: stil afsluiten
  t.at('2026-12-02T23:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);
  assert.equal(t.bot.state.matches['2026-12-02'].status, 'played');

  // Maandag 7 december: volgende aankondiging met het bijgewerkte overzicht
  t.at('2026-12-07T18:00');
  await t.bot.tick();
  const [announce2] = t.take();
  assert.match(announce2, /woensdag 16 december[\s\S]*vorige 3 wedstrijden\):\n• An: 1\n• Els: 1\n• Piet: 2\n• Tom: 2\n• Frederic: 3\n• Jan: 3$/);

  await t.vote('An', true, 'poll1');
  assert.equal(t.bot.openMatch().yesOrder.length, 0, 'stem op de oude peiling genegeerd');
  assert.match(await t.cmd('Jan', '!historiek'), /• 2 dec 2026: Jan, Tom, Piet en Frederic/);
});

test('afhaken zonder reserve, stem intrekken, nieuwe 4e speler na dinsdag', async () => {
  const t = setup();
  await t.members(['Jan', 'Els', 'Tom', 'Piet', 'An']);
  await t.bot.tick();
  t.take();
  for (const n of ['Jan', 'Els', 'Tom', 'Piet']) await t.vote(n, true);
  t.take();
  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['❌ Els kan niet meer – nog 1 speler nodig']);
  await t.vote('Tom', null);
  assert.deepEqual(t.take(), ['↩️ Tom: stem ingetrokken – nog 2 spelers nodig']);
  await t.vote('Els', null);
  assert.deepEqual(t.take(), ['↩️ Els: stem ingetrokken']);

  t.at('2026-11-24T18:00');
  await t.bot.tick();
  assert.match(t.take()[0], /^⚠️ Voor woensdag 2 december ontbreken nog 2 spelers/);

  // Na dinsdag wordt het team toch nog volledig: opnieuw een bevestiging
  t.at('2026-11-28T10:00');
  await t.vote('An', true);
  await t.vote('Tom', true);
  assert.deepEqual(t.take(), [
    '✅ An kan spelen (3/4)',
    '✅ Tom kan spelen (4/4) – het team voor woensdag 2 december staat vast: Jan, Piet, An en Tom.'
  ]);
});

test('dinsdag: geen bericht als het team al volledig is', async () => {
  const t = setup();
  await t.members(['Jan', 'Els', 'Tom', 'Piet']);
  await t.bot.tick();
  for (const n of ['Jan', 'Els', 'Tom', 'Piet']) await t.vote(n, true);
  t.take();
  t.at('2026-11-24T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);
});

test('gasten: stand bij !gast, voorrang voor groepsleden, herhaling met ontbrekende spelers', async () => {
  const t = setup();
  await t.members(['Jan', 'Els', 'Tom', 'Piet', 'An', 'Frederic']);
  await t.bot.tick();
  t.take();
  await t.vote('Jan', true);
  await t.vote('Els', true);
  await t.vote('An', false);
  t.take();

  const r1 = await t.cmd('Jan', '!gast Marc');
  assert.equal(r1,
    'Marc (gast) speelt mee. Voor woensdag 2 december ontbreekt nog 1 speler.\n\n' +
    '📋 Stand voor woensdag 2 december\n' +
    '✅ Speelt: Jan, Els en Marc (gast) (nog 1 nodig)\n' +
    '🔁 Reserve: –\n' +
    '❌ Kan niet: An\n' +
    '❓ Nog niet geantwoord: Tom, Piet en Frederic');
  const r2 = await t.cmd('Jan', '!gast Lien');
  assert.match(r2, /^Lien \(gast\) speelt mee\. Het team is volledig\.\n\n📋 Stand/);
  assert.deepEqual(t.take(), ['✅ Het team voor woensdag 2 december staat vast: Jan, Els, Marc (gast) en Lien (gast).']);

  // Een groepslid stemt alsnog ja: voorrang op de gast
  await t.vote('Tom', true);
  assert.deepEqual(t.take(), ['✅ Tom kan spelen (4/4) – Lien (gast) is niet meer nodig']);
  assert.match(await t.cmd('Jan', '!status'), /🔁 Reserve: Lien \(gast\)/);

  const r3 = await t.cmd('Jan', '!gast weg Marc');
  assert.match(r3, /^Marc \(gast\) is van de lijst gehaald\.\n\n📋 Stand/);
  assert.deepEqual(t.take(), ['🔄 Marc (gast) haakt af, Lien (gast) speelt mee.\nTeam voor woensdag 2 december: Jan, Els, Tom en Lien (gast).']);

  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['❌ Els kan niet meer – nog 1 speler nodig']);

  // Herhaling de dag ervoor, met een onvolledig team
  t.at('2026-12-01T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), [
    '⚠️ Morgen padel, maar voor woensdag 2 december ontbreekt nog 1 speler. Nu spelen: Jan, Tom en Lien (gast). ' +
    'Voeg een gast toe met !gast naam, of typ !geen als de wedstrijd niet doorgaat.'
  ]);
  t.at('2026-12-02T23:30');
  await t.bot.tick();
  assert.equal(t.bot.state.matches['2026-12-02'].status, 'notplayed');
});

test('!geen, !naam, !status, onbekend commando en geen !gereserveerd meer', async () => {
  const t = setup();
  await t.members(['Jan', 'Els']);
  assert.equal(await t.cmd('Jan', '!status'), 'Er is op dit moment geen wedstrijd aangekondigd.');
  await t.bot.tick();
  t.take();
  assert.equal(await t.cmd('Jan', '!naam Johnny'), '👍 Je naam is nu Johnny.');
  await t.vote('Jan', true);
  assert.deepEqual(t.take(), ['✅ Johnny kan spelen (1/4)']);
  assert.equal(await t.cmd('Els', '!status'),
    '📋 Stand voor woensdag 2 december\n✅ Speelt: Johnny (nog 3 nodig)\n🔁 Reserve: –\n❌ Kan niet: –\n❓ Nog niet geantwoord: Els');
  assert.match(await t.cmd('Els', '!gereserveerd'), /^Onbekend commando/);
  assert.doesNotMatch(await t.cmd('Els', '!help'), /gereserveerd/);
  assert.equal(await t.cmd('Els', 'gewoon een bericht'), null);
  assert.equal(await t.cmd('Els', '!geen'), '❌ De wedstrijd van woensdag 2 december gaat niet door. Ze telt niet mee in het overzicht.');
  assert.equal(t.bot.openMatch(), null);
  // Geen herhaling voor een geschrapte wedstrijd; de volgende wordt wel aangekondigd
  t.at('2026-12-01T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);
  t.at('2026-12-07T18:00');
  await t.bot.tick();
  assert.match(t.take()[0], /woensdag 16 december/);
});

test('nieuw en vertrokken groepslid', async () => {
  const t = setup();
  await t.members(['Jan', 'Els', 'Tom', 'Piet']);
  await t.bot.tick();
  t.take();
  for (const n of ['Jan', 'Els', 'Tom', 'Piet']) await t.vote(n, true);
  t.take();
  await t.bot.syncMembers(['Jan', 'Els', 'Tom', 'Nina'].map((n) => ({ ids: [`${n}@s.whatsapp.net`] })));
  assert.deepEqual(t.take(), ['⚠️ Piet haakt af. Voor woensdag 2 december ontbreekt nog 1 speler. Wie kan er nog? Stem in de peiling, of voeg een gast toe met !gast naam.']);
  assert.deepEqual(t.bot.activeMembers().map((p) => t.bot.displayName(p)).sort(), ['+Nina', 'Els', 'Jan', 'Tom']);
});

test('LID en telefoonnummer van dezelfde persoon worden samengevoegd', () => {
  const t = setup();
  const a = t.bot.upsertPerson(['123@lid', '3247@s.whatsapp.net']);
  const b = t.bot.upsertPerson(['123@lid'], 'Jan');
  assert.equal(a, b);
  assert.equal(t.bot.displayName(a), 'Jan');
});

test('late start (Pi stond uit): geen dubbele berichten achteraf', async () => {
  const t = setup({ start: '2026-11-24T19:00' });
  await t.members(['Jan', 'Els']);
  await t.bot.tick();
  assert.equal(t.take().length, 2, 'alleen aankondiging + peiling, geen dinsdagbericht erachteraan');
  t.at('2026-12-01T18:00');
  await t.bot.tick();
  assert.match(t.take()[0], /^⚠️ Morgen padel/, 'de herhaling volgt wel nog normaal');
});

test('herinnering om de eSIM te herladen', async () => {
  const t = setup({ start: '2026-11-24T18:00', herlading: '2026-03-20' });
  await t.bot.tick(); // DIGI: 9 maanden geldig, vervalt op 2026-12-20: nog 26 dagen
  assert.equal(t.notes.length, 1);
  assert.match(t.notes[0], /binnen 26 dagen/);
  await t.bot.tick();
  assert.equal(t.notes.length, 1, 'niet elke minuut opnieuw');
  t.at('2026-12-06T18:00'); // 14 dagen
  await t.bot.tick();
  assert.equal(t.notes.length, 2);
  t.at('2026-12-17T18:00'); // 3 dagen
  await t.bot.tick();
  t.at('2026-12-20T18:00'); // vandaag
  await t.bot.tick();
  assert.equal(t.notes.length, 4);
  assert.match(t.notes[3], /nu herladen/);
});

test('testmodus: de planning meteen uitvoeren', async () => {
  const off = setup({ start: '2026-11-22T16:00' });
  await off.members(['Jan']);
  assert.match(await off.cmd('Jan', '!test aankondigen'), /^Onbekend commando/);
  assert.equal(off.bot.openMatch(), null, 'zonder testmodus gebeurt er niets');

  const t = setup({ start: '2026-11-22T16:00', testmodus: true });
  await t.members(['Jan', 'Els', 'Tom']);
  assert.match(await t.cmd('Jan', '!help'), /!test aankondigen/);
  assert.equal(await t.cmd('Jan', '!test dinsdag'), 'Er is geen wedstrijd aangekondigd. Begin met !test aankondigen.');

  assert.equal(await t.cmd('Jan', '!test aankondigen'), null);
  const [announce, poll] = t.take();
  assert.match(announce, /woensdag 2 december/);
  assert.match(poll, /^POLL Kan jij spelen op woensdag 2 december\?/);
  assert.match(await t.cmd('Jan', '!test aankondigen'), /Er is al een wedstrijd aangekondigd/);

  await t.vote('Jan', true);
  await t.vote('Els', true);
  t.take();
  await t.cmd('Jan', '!test dinsdag');
  assert.match(t.take()[0], /^⚠️ Voor woensdag 2 december ontbreken nog 2 spelers/);
  await t.cmd('Jan', '!test herhaling');
  assert.match(t.take()[0], /^⚠️ Morgen padel, maar voor woensdag 2 december ontbreken nog 2 spelers/);

  await t.vote('Tom', true);
  await t.cmd('Jan', '!gast Marc');
  t.take();
  assert.equal(await t.cmd('Jan', '!test dinsdag'), 'Test: het team is volledig, dus op dinsdag komt er geen bericht.');
  await t.cmd('Jan', '!test herhaling');
  assert.deepEqual(t.take(), ['🎾 Morgen padel! Op woensdag 2 december spelen: Jan, Els, Tom en Marc (gast).']);
  assert.equal(await t.cmd('Jan', '!test afsluiten'),
    'Test: de wedstrijd van woensdag 2 december is afgesloten en gespeeld door Jan, Els, Tom en Marc (gast).');

  // Tweede ronde: volgende vrije speeldag, met het overzicht van de vorige wedstrijd
  await t.cmd('Jan', '!test aankondigen');
  assert.match(t.take()[0], /woensdag 16 december[\s\S]*vorige wedstrijd\):\n• Els: 1\n• Jan: 1\n• Tom: 1/);

  // De echte planning stuurt niets dubbel zolang de testwedstrijd open staat
  t.at('2026-11-23T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);

  assert.equal(await t.cmd('Jan', '!test wissen'), 'Test: alle wedstrijden en de historiek zijn gewist. De ledenlijst blijft behouden.');
  assert.equal(t.bot.openMatch(), null);
  assert.equal(t.bot.activeMembers().length, 3);
  await t.bot.tick();
  assert.match(t.take()[0], /woensdag 2 december/, 'na het wissen kondigt de echte planning gewoon aan');
});

test('oude wedstrijd zonder "votes" en "eve" (van vóór 0.1.5) blijft werken', async () => {
  const t = setup();
  await t.members(['Jan', 'Els', 'Tom']);
  await t.bot.tick();
  t.take();
  await t.vote('Jan', true);
  t.take();
  const m = t.bot.openMatch();
  delete m.votes;
  delete m.flags.eve;
  m.flags.reminder = false;
  assert.match(await t.cmd('Els', '!status'), /✅ Speelt: Jan \(nog 3 nodig\)[\s\S]*❓ Nog niet geantwoord: Els en Tom/);
  await t.vote('Jan', true);
  assert.equal(t.take().length, 0, 'bestaande ja-stem wordt herkend');
  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['❌ Els kan niet']);
});
