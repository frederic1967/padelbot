import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Bot, NO, YES } from '../src/bot.js';
import { Store } from '../src/store.js';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const silent = { info() {}, warn() {}, error() {} };

/** Testopstelling: nep-WhatsApp, verstelbare klok (lokale tijd Brussel, winteruur). */
function setup({ start = '2026-11-24T18:00', herlading = '', testmodus = false } = {}) {
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

test('volledig verloop van een speeldag', async () => {
  const t = setup({ start: '2026-11-24T17:59' });
  await t.members(['Jan', 'Els', 'Tom', 'Piet', 'An', 'Frederic']);

  await t.bot.tick();
  assert.equal(t.take().length, 0, 'nog niets vóór 18:00');

  t.at('2026-11-24T18:00');
  await t.bot.tick();
  const [announce, poll] = t.take();
  assert.match(announce, /^🎾 Onze volgende wedstrijd is op woensdag 2 december\.\nWelke vier spelers kunnen er spelen\?/);
  assert.match(announce, /Nog geen gespeelde wedstrijden/);
  assert.equal(poll, `POLL Kan jij spelen op woensdag 2 december? [${YES}|${NO}]`);

  // Een tweede tick stuurt niets dubbel
  await t.bot.tick();
  assert.equal(t.take().length, 0);

  await t.vote('Jan', true);
  await t.vote('Els', true);
  await t.vote('Tom', true);
  assert.equal(t.take().length, 0, 'geen bericht per stem');
  await t.vote('An', false);
  await t.vote('Piet', true);
  assert.deepEqual(t.take(), [
    '✅ Het team voor woensdag 2 december staat vast: Jan, Els, Tom en Piet.\nWie reserveert het terrein? Typ !gereserveerd als het geregeld is.'
  ]);

  await t.vote('Frederic', true);
  assert.deepEqual(t.take(), ['Het team is al volledig. Frederic, je staat op de reservelijst (1e reserve).']);

  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['🔄 Els haakt af, Frederic speelt mee.\nTeam voor woensdag 2 december: Jan, Tom, Piet en Frederic.']);

  // Els stemt opnieuw ja: ze sluit achteraan aan als reserve
  await t.vote('Els', true);
  assert.deepEqual(t.take(), ['Het team is al volledig. Els, je staat op de reservelijst (1e reserve).']);

  assert.equal(await t.cmd('Tom', '!gereserveerd'), '✅ Terrein gereserveerd door Tom.');

  t.at('2026-11-25T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), [
    '✅ Het team voor woensdag 2 december staat vast: Jan, Tom, Piet en Frederic.\nHet terrein is gereserveerd door Tom.'
  ]);

  t.at('2026-11-26T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0, 'geen herinnering als het team volledig is');

  // Speeldag 's avonds: afsluiten
  t.at('2026-12-02T23:00');
  await t.bot.tick();
  assert.equal(t.bot.state.matches['2026-12-02'].status, 'played');
  assert.equal(t.bot.openMatch(), null);

  // Volgende aankondiging: dinsdag 8 december voor woensdag 16 december
  t.at('2026-12-08T18:00');
  await t.bot.tick();
  const [announce2] = t.take();
  assert.match(announce2, /woensdag 16 december/);
  assert.match(announce2, /vorige wedstrijd\):\n• An: 0\n• Els: 0\n• Frederic: 1\n• Jan: 1\n• Piet: 1\n• Tom: 1$/);

  // Stem op de oude peiling wordt genegeerd
  await t.vote('An', true, 'poll1');
  assert.equal(t.bot.openMatch().yesOrder.length, 0);

  assert.match(await t.cmd('Jan', '!historiek'), /• 2 dec 2026: Jan, Tom, Piet en Frederic/);
});

test('te weinig spelers: woensdag melding, donderdag één herinnering, gasten', async () => {
  const t = setup({ start: '2026-11-24T18:00' });
  await t.members(['Jan', 'Els', 'Tom', 'Piet', 'An', 'Frederic']);
  await t.bot.tick();
  t.take();
  await t.vote('Jan', true);
  await t.vote('Els', true);

  t.at('2026-11-25T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), ['⚠️ Voor woensdag 2 december ontbreken nog 2 spelers. Wie kan er nog? Stem in de peiling hierboven, of voeg een gast toe met !gast naam.']);

  t.at('2026-11-26T18:00');
  await t.bot.tick();
  assert.deepEqual(t.take(), ['⏰ Herinnering: voor woensdag 2 december ontbreken nog 2 spelers. Stem in de peiling, of voeg een gast toe met !gast naam.']);

  t.at('2026-11-27T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0, 'daarna geen herinneringen meer');

  assert.equal(await t.cmd('Jan', '!gast Marc'), 'Marc (gast) speelt mee. Voor woensdag 2 december ontbreekt nog 1 speler.');
  assert.equal(await t.cmd('Jan', '!gast Lien'), null);
  assert.deepEqual(t.take(), ['✅ Het team voor woensdag 2 december staat vast: Jan, Els, Marc (gast) en Lien (gast).\nWie reserveert het terrein? Typ !gereserveerd als het geregeld is.']);

  // Een groepslid stemt alsnog ja: voorrang op de gast
  await t.vote('Tom', true);
  assert.deepEqual(t.take(), ['🔄 Tom speelt mee, dus Lien (gast) is niet meer nodig.\nTeam voor woensdag 2 december: Jan, Els, Tom en Marc (gast).']);

  assert.equal(await t.cmd('Jan', '!gast weg Marc'), 'Marc (gast) is van de lijst gehaald.');
  assert.deepEqual(t.take(), ['🔄 Marc (gast) haakt af, Lien (gast) speelt mee.\nTeam voor woensdag 2 december: Jan, Els, Tom en Lien (gast).']);

  // Iemand haakt af zonder reserve
  await t.vote('Els', false);
  assert.deepEqual(t.take(), ['⚠️ Els haakt af. Voor woensdag 2 december ontbreekt nog 1 speler. Wie kan er nog? Stem in de peiling, of voeg een gast toe met !gast naam.']);

  t.at('2026-12-02T23:30');
  await t.bot.tick();
  assert.equal(t.bot.state.matches['2026-12-02'].status, 'notplayed');
});

test('!geen, !naam, !status en onbekend commando', async () => {
  const t = setup({ start: '2026-11-24T18:00' });
  await t.members(['Jan', 'Els']);
  assert.equal(await t.cmd('Jan', '!status'), 'Er is op dit moment geen wedstrijd aangekondigd.');
  await t.bot.tick();
  t.take();
  assert.equal(await t.cmd('Jan', '!naam Johnny'), '👍 Je naam is nu Johnny.');
  await t.vote('Jan', true);
  assert.match(await t.cmd('Els', '!status'), /Team: Johnny\nEr ontbreken nog 3 spelers\./);
  assert.match(await t.cmd('Els', '!onzin'), /^Onbekend commando/);
  assert.equal(await t.cmd('Els', 'gewoon een bericht'), null);
  assert.equal(await t.cmd('Els', '!geen'), '❌ De wedstrijd van woensdag 2 december gaat niet door. Ze telt niet mee in het overzicht.');
  assert.equal(t.bot.openMatch(), null);
  // De geannuleerde wedstrijd wordt niet opnieuw aangekondigd; de volgende wel
  t.at('2026-11-25T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);
  t.at('2026-12-08T18:00');
  await t.bot.tick();
  assert.match(t.take()[0], /woensdag 16 december/);
});

test('nieuw en vertrokken groepslid', async () => {
  const t = setup({ start: '2026-11-24T18:00' });
  await t.members(['Jan', 'Els', 'Tom', 'Piet']);
  await t.bot.tick();
  t.take();
  for (const n of ['Jan', 'Els', 'Tom', 'Piet']) await t.vote(n, true);
  t.take();
  // Piet verlaat de groep, Nina komt erbij
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

test('late start (Pi stond uit): geen dubbele berichten', async () => {
  const t = setup({ start: '2026-11-25T19:00' });
  await t.members(['Jan', 'Els']);
  await t.bot.tick();
  const msgs = t.take();
  assert.equal(msgs.length, 2, 'alleen aankondiging + peiling, geen statusbericht erachteraan');
  // De herinnering van donderdag volgt wel nog normaal
  t.at('2026-11-26T18:00');
  await t.bot.tick();
  assert.match(t.take()[0], /^⏰ Herinnering/);
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
  assert.equal(await t.cmd('Jan', '!test woensdag'), 'Er is geen wedstrijd aangekondigd. Begin met !test aankondigen.');

  assert.equal(await t.cmd('Jan', '!test aankondigen'), null);
  const [announce, poll] = t.take();
  assert.match(announce, /woensdag 2 december/);
  assert.match(poll, /^POLL Kan jij spelen op woensdag 2 december\?/);
  assert.match(await t.cmd('Jan', '!test aankondigen'), /Er is al een wedstrijd aangekondigd/);

  await t.vote('Jan', true);
  await t.vote('Els', true);
  await t.cmd('Jan', '!test woensdag');
  assert.match(t.take()[0], /^⚠️ Voor woensdag 2 december ontbreken nog 2 spelers/);
  await t.cmd('Jan', '!test donderdag');
  assert.match(t.take()[0], /^⏰ Herinnering/);

  await t.vote('Tom', true);
  await t.cmd('Jan', '!gast Marc');
  t.take();
  assert.equal(await t.cmd('Jan', '!test afsluiten'),
    'Test: de wedstrijd van woensdag 2 december is afgesloten en gespeeld door Jan, Els, Tom en Marc (gast).');

  // Tweede ronde: volgende vrije speeldag, met het overzicht van de vorige wedstrijd
  await t.cmd('Jan', '!test aankondigen');
  assert.match(t.take()[0], /woensdag 16 december[\s\S]*vorige wedstrijd\):\n• Els: 1\n• Jan: 1\n• Tom: 1/);

  // De echte planning stuurt geen dubbele berichten zolang de testwedstrijd open staat
  t.at('2026-11-24T18:00');
  await t.bot.tick();
  assert.equal(t.take().length, 0);

  assert.equal(await t.cmd('Jan', '!test wissen'), 'Test: alle wedstrijden en de historiek zijn gewist. De ledenlijst blijft behouden.');
  assert.equal(t.bot.openMatch(), null);
  assert.equal(t.bot.activeMembers().length, 3);
  // Na het wissen kondigt de echte planning gewoon aan
  await t.bot.tick();
  assert.match(t.take()[0], /woensdag 2 december/);
});
