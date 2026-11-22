// De logica van de padelbot, los van WhatsApp zelf (zodat ze getest kan worden).
import crypto from 'node:crypto';
import {
  addDays, addMonths, atOrAfter, daysBetween, formatDateNl, formatShortNl, localNow, nextMatchDate, planFor
} from './schedule.js';
import { applyVote, computeTeam, describeChange, listNl, missingText } from './team.js';

export const YES = '✅ Ja';
export const NO = '❌ Nee';
const YES_HASH = crypto.createHash('sha256').update(YES).digest('hex');
const NO_HASH = crypto.createHash('sha256').update(NO).digest('hex');
const OVERVIEW_MATCHES = 6;
const TOPUP_THRESHOLDS = [30, 14, 3, 0];

export class Bot {
  /**
   * @param {object} deps
   * @param {import('./store.js').Store} deps.store
   * @param {{tijdstip: string, tijdzone: string, laatste_herlading?: string, geldigheid_maanden?: number}} deps.config
   * @param {{sendText(t: string): Promise<void>, sendPoll(q: string, opts: string[]): Promise<{id: string, secret: string}>}} deps.wa
   * @param {(title: string, message: string) => Promise<void>} deps.notify
   * @param {() => Date} [deps.clock]
   * @param {{info: Function, warn: Function, error: Function}} [deps.log]
   */
  constructor({ store, config, wa, notify, clock = () => new Date(), log = console }) {
    Object.assign(this, { store, config, wa, notify, clock, log });
  }

  get state() { return this.store.state; }
  now() { return localNow(this.config.tijdzone, this.clock()); }

  // ---------------------------------------------------------------- personen

  findPerson(ids) {
    const wanted = ids.filter(Boolean);
    for (const [pid, p] of Object.entries(this.state.people)) {
      if (p.ids.some((id) => wanted.includes(id))) return pid;
    }
    return null;
  }

  upsertPerson(ids, pushName) {
    const clean = [...new Set(ids.filter(Boolean))];
    let pid = this.findPerson(clean);
    if (!pid) {
      pid = clean[0];
      this.state.people[pid] = { ids: [], name: null, customName: null, active: true };
    }
    const p = this.state.people[pid];
    for (const id of clean) if (!p.ids.includes(id)) p.ids.push(id);
    if (pushName) p.name = pushName;
    p.active = true;
    return pid;
  }

  displayName(pid) {
    const p = this.state.people[pid];
    if (!p) return 'Onbekend';
    if (p.customName) return p.customName;
    if (p.name) return p.name;
    const pn = p.ids.find((id) => id.endsWith('@s.whatsapp.net'));
    return pn ? `+${pn.split('@')[0]}` : 'Onbekend';
  }

  activeMembers() {
    return Object.keys(this.state.people).filter((pid) => this.state.people[pid].active);
  }

  /**
   * Synchroniseer de ledenlijst met de groep.
   * @param {{ids: string[], name?: string}[]} participants (zonder de bot zelf)
   */
  async syncMembers(participants) {
    const seen = new Set();
    for (const part of participants) seen.add(this.upsertPerson(part.ids, part.name));
    const left = [];
    for (const [pid, p] of Object.entries(this.state.people)) {
      if (!seen.has(pid) && p.active) { p.active = false; left.push(pid); }
    }
    // Wie de groep verlaat, valt uit het team van de lopende wedstrijd.
    const match = this.openMatch();
    if (match && left.some((pid) => match.yesOrder.includes(pid))) {
      await this.changeMatch(match, (m) => { m.yesOrder = m.yesOrder.filter((pid) => !left.includes(pid)); });
    }
    this.store.save();
  }

  // ---------------------------------------------------------------- wedstrijden

  openMatch() {
    return Object.values(this.state.matches).find((m) => m.status === 'open') || null;
  }

  playedMatches() {
    return Object.values(this.state.matches)
      .filter((m) => m.status === 'played')
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // nieuwste eerst
  }

  overviewCounts() {
    const recent = this.playedMatches().slice(0, OVERVIEW_MATCHES);
    const counts = Object.fromEntries(this.activeMembers().map((pid) => [pid, 0]));
    for (const m of recent) for (const pid of m.team.members) if (pid in counts) counts[pid] += 1;
    const rows = Object.entries(counts)
      .map(([pid, n]) => ({ name: this.displayName(pid), n }))
      .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name, 'nl'));
    return { rows, played: recent.length };
  }

  announceText(match) {
    const { rows, played } = this.overviewCounts();
    const header = played === 0
      ? 'Nog geen gespeelde wedstrijden geregistreerd.'
      : `Aantal keer meegespeeld (vorige ${played === 1 ? 'wedstrijd' : `${played} wedstrijden`}):`;
    const list = rows.map((r) => `• ${r.name}: ${r.n}`).join('\n');
    return `🎾 Onze volgende wedstrijd is op ${formatDateNl(match.date)}.\n` +
      'Welke vier spelers kunnen er spelen?\n\n' +
      `${header}\n${list}`;
  }

  teamNames(team) {
    return [...team.members.map((pid) => this.displayName(pid)), ...team.guests.map((g) => `${g} (gast)`)];
  }

  /** Pas een wedstrijd aan en meld wat er aan het team veranderde. */
  async changeMatch(match, mutate) {
    const before = computeTeam(match);
    mutate(match);
    const after = computeTeam(match);
    this.store.save();
    const msgs = describeChange(before, after, {
      name: (pid) => this.displayName(pid),
      dateText: formatDateNl(match.date)
    });
    for (const m of msgs) await this.wa.sendText(m);
  }

  async announce(date) {
    const now = this.now();
    const plan = planFor(date, this.config.tijdstip);
    const match = {
      date,
      status: 'open',
      poll: null,
      yesOrder: [],
      guests: [],
      votes: {},
      // Te laat aangekondigd (bv. Pi stond uit)? Dan geen dubbele berichten achteraf.
      flags: { announced: false, status: atOrAfter(now, plan.status), eve: atOrAfter(now, plan.eve) },
      team: null
    };
    this.state.matches[date] = match;
    this.store.save();
    await this.ensureAnnounced(match);
    this.log.info(`Wedstrijd van ${date} aangekondigd`);
  }

  /** Aankondiging en peiling versturen; wat mislukte, wordt bij de volgende tick opnieuw geprobeerd. */
  async ensureAnnounced(match) {
    if (!match.flags.announced) {
      await this.wa.sendText(this.announceText(match));
      match.flags.announced = true;
      this.store.save();
    }
    if (!match.poll) {
      match.poll = await this.wa.sendPoll(`Kan jij spelen op ${formatDateNl(match.date)}?`, [YES, NO]);
      this.store.save();
    }
  }

  /** Dinsdag (8 dagen vooraf): alleen een bericht als het team nog niet volledig is. */
  async sendStatus(match) {
    const team = computeTeam(match);
    if (team.complete) return false;
    await this.wa.sendText(
      `⚠️ Voor ${formatDateNl(match.date)} ${missingText(team.missing)}. Wie kan er nog? ` +
      'Stem in de peiling hierboven, of voeg een gast toe met !gast naam.\n\n' +
      this.standText(match)
    );
    return true;
  }

  /** De dag vóór de wedstrijd: herhaling van wie er speelt. */
  async sendEve(match) {
    const team = computeTeam(match);
    const dateText = formatDateNl(match.date);
    const names = this.teamNames(team);
    if (team.complete) {
      await this.wa.sendText(`🎾 Morgen padel! Op ${dateText} spelen: ${listNl(names)}.`);
    } else {
      await this.wa.sendText(
        `⚠️ Morgen padel, maar voor ${dateText} ${missingText(team.missing)}. ` +
        `Nu spelen: ${names.length ? listNl(names) : 'nog niemand'}. ` +
        'Voeg een gast toe met !gast naam, of typ !geen als de wedstrijd niet doorgaat.'
      );
    }
  }

  /** Groepsleden die nog niet in de peiling stemden. */
  notAnswered(match) {
    const votes = match.votes || {};
    return this.activeMembers().filter((pid) => !(pid in votes) && !match.yesOrder.includes(pid));
  }

  /** Overzicht: wie speelt, reserves, wie niet kan, wie nog niet antwoordde. */
  standText(match) {
    const team = computeTeam(match);
    const names = (ids) => ids.map((p) => this.displayName(p));
    const list = (arr) => (arr.length ? listNl(arr) : '–');
    const no = Object.entries(match.votes || {})
      .filter(([pid, v]) => v === 'no' && this.state.people[pid]?.active)
      .map(([pid]) => pid);
    const reserves = [...names(team.reserves), ...team.spareGuests.map((g) => `${g} (gast)`)];
    return [
      `📋 Stand voor ${formatDateNl(match.date)}`,
      `✅ Speelt: ${list(this.teamNames(team))}${team.complete ? '' : ` (nog ${team.missing} nodig)`}`,
      `🔁 Reserve: ${list(reserves)}`,
      `❌ Kan niet: ${list(names(no))}`,
      `❓ Nog niet geantwoord: ${list(names(this.notAnswered(match)))}`
    ].join('\n');
  }

  finalize(match) {
    const team = computeTeam(match);
    match.status = team.complete ? 'played' : 'notplayed';
    match.team = { members: team.members, guests: team.guests };
    this.store.save();
    this.log.info(`Wedstrijd van ${match.date} afgesloten: ${match.status}`);
  }

  /** Wordt elke minuut aangeroepen. Stuurt de geplande berichten. */
  async tick() {
    const now = this.now();

    // 1. Afgelopen wedstrijden afsluiten (ook na een stroomonderbreking).
    for (const m of Object.values(this.state.matches)) {
      if (m.status === 'open' && atOrAfter(now, planFor(m.date, this.config.tijdstip).finalize)) this.finalize(m);
    }

    let match = this.openMatch();

    // 2. Volgende wedstrijd aankondigen op de maandag, 9 dagen vooraf.
    if (!match) {
      let date = nextMatchDate(now.date);
      if (this.state.matches[date]) date = nextMatchDate(addDays(date, 1));
      const plan = planFor(date, this.config.tijdstip);
      if (atOrAfter(now, plan.announce) && now.date < date) {
        await this.announce(date);
      }
      match = this.openMatch();
      if (!match) return this.checkTopup(now);
    }

    // Aankondiging of peiling mislukt (bv. verbinding even weg)? Opnieuw proberen.
    await this.ensureAnnounced(match);

    // 3. Dinsdag (8 dagen vooraf): alleen als het team nog niet volledig is.
    const plan = planFor(match.date, this.config.tijdstip);
    if (!match.flags.status && atOrAfter(now, plan.status)) {
      match.flags.status = true;
      this.store.save();
      // Pi stond uit tot na de herhaling? Dan is het dinsdagbericht achterhaald.
      if (!atOrAfter(now, plan.eve)) await this.sendStatus(match);
    }
    // 4. De dag vóór de wedstrijd: herhaling van wie er speelt.
    if (!match.flags.eve && atOrAfter(now, plan.eve)) {
      match.flags.eve = true;
      this.store.save();
      await this.sendEve(match);
    }
    await this.checkTopup(now);
  }

  // ---------------------------------------------------------------- peiling

  pollSecret(pollId) {
    const m = Object.values(this.state.matches).find((x) => x.poll && x.poll.id === pollId);
    return m ? m.poll.secret : null;
  }

  /**
   * Een (ontsleutelde) stem in de peiling.
   * @param {{pollId: string, senderIds: string[], pushName?: string, selectedHashes: string[]}} vote
   */
  async handleVote({ pollId, senderIds, pushName, selectedHashes }) {
    const match = this.openMatch();
    if (!match || !match.poll || match.poll.id !== pollId) return; // oude peiling
    const pid = this.upsertPerson(senderIds, pushName);
    const vote = selectedHashes.includes(YES_HASH) ? 'yes' : selectedHashes.includes(NO_HASH) ? 'no' : null;
    match.votes = match.votes || {};
    const prev = match.votes[pid] || (match.yesOrder.includes(pid) ? 'yes' : null);
    if (prev === vote) return; // niets veranderd

    const before = computeTeam(match);
    match.yesOrder = applyVote(match.yesOrder, pid, vote === 'yes');
    if (vote) match.votes[pid] = vote;
    else delete match.votes[pid]; // stem ingetrokken = nog niet geantwoord
    const after = computeTeam(match);
    this.store.save();
    await this.wa.sendText(this.voteLine(match, pid, vote, before, after));
  }

  /** Eén regel per stem, zoals in een gewone chat. */
  voteLine(match, pid, vote, before, after) {
    const name = this.displayName(pid);
    const size = (t) => t.members.length + t.guests.length;
    const teamNames = (t) => [...t.members.map((p) => this.displayName(p)), ...t.guests.map((g) => `${g} (gast)`)];
    const joined = teamNames(after).filter((n) => !teamNames(before).includes(n) && n !== name);
    const left = teamNames(before).filter((n) => !teamNames(after).includes(n) && n !== name);

    if (vote === 'yes') {
      if (!after.members.includes(pid)) {
        return `✅ ${name} kan spelen – ${after.reserves.indexOf(pid) + 1}e reserve`;
      }
      let line = `✅ ${name} kan spelen (${size(after)}/4)`;
      if (left.length) line += ` – ${listNl(left)} ${left.length > 1 ? 'zijn' : 'is'} niet meer nodig`;
      if (after.complete && !before.complete) {
        line += ` – het team voor ${formatDateNl(match.date)} staat vast: ${listNl(teamNames(after))}.`;
      }
      return line;
    }

    const wasInTeam = before.members.includes(pid);
    const head = vote === 'no'
      ? `❌ ${name} ${wasInTeam || before.reserves.includes(pid) ? 'kan niet meer' : 'kan niet'}`
      : `↩️ ${name}: stem ingetrokken`;
    if (!wasInTeam) return head;
    if (joined.length) {
      let line = `${head} – ${listNl(joined)} ${joined.length > 1 ? 'spelen' : 'speelt'} mee`;
      if (after.complete && !before.complete) line += ` – het team staat vast: ${listNl(teamNames(after))}.`;
      return line;
    }
    return `${head} – ${after.missing === 1 ? 'nog 1 speler nodig' : `nog ${after.missing} spelers nodig`}`;
  }

  // ---------------------------------------------------------------- commando's

  /**
   * Verwerk een bericht uit de groep. Geeft het antwoord terug (of null).
   * @param {{senderIds: string[], pushName?: string, text: string}} msg
   */
  async handleCommand({ senderIds, pushName, text }) {
    const trimmed = (text || '').trim();
    if (!trimmed.startsWith('!')) {
      if (senderIds.length) { this.upsertPerson(senderIds, pushName); this.store.save(); } // naam bijhouden
      return null;
    }
    const pid = this.upsertPerson(senderIds, pushName);
    this.store.save();
    const [cmdRaw, ...rest] = trimmed.slice(1).split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(' ').trim();
    const match = this.openMatch();
    const noMatch = 'Er is op dit moment geen wedstrijd aangekondigd.';

    switch (cmd) {
      case 'gast': {
        if (!match) return noMatch;
        const isRemove = /^weg\b/i.test(arg);
        const guest = cleanName(isRemove ? arg.replace(/^weg\b/i, '') : arg);
        if (!guest) return 'Gebruik: !gast Marc (toevoegen) of !gast weg Marc (verwijderen).';
        const existing = match.guests.find((g) => g.toLowerCase() === guest.toLowerCase());
        if (isRemove) {
          if (!existing) return `${guest} staat niet als gast op de lijst.`;
          await this.changeMatch(match, (m) => { m.guests = m.guests.filter((g) => g !== existing); });
          return `${existing} (gast) is van de lijst gehaald.\n\n${this.standText(match)}`;
        }
        if (existing) return `${existing} staat al als gast op de lijst.`;
        const wasComplete = computeTeam(match).complete;
        await this.changeMatch(match, (m) => { m.guests.push(guest); });
        const after = computeTeam(match);
        let head;
        if (wasComplete) head = `Het team is al volledig. ${guest} (gast) staat klaar als reserve.`;
        else if (after.complete) head = `${guest} (gast) speelt mee. Het team is volledig.`;
        else head = `${guest} (gast) speelt mee. Voor ${formatDateNl(match.date)} ${missingText(after.missing)}.`;
        return `${head}\n\n${this.standText(match)}`;
      }
      case 'geen': {
        if (!match) return noMatch;
        match.status = 'cancelled';
        match.team = { members: [], guests: [] };
        this.store.save();
        return `❌ De wedstrijd van ${formatDateNl(match.date)} gaat niet door. Ze telt niet mee in het overzicht.`;
      }
      case 'naam': {
        const name = cleanName(arg);
        if (!name) return 'Gebruik: !naam Jan';
        this.state.people[pid].customName = name;
        this.store.save();
        return `👍 Je naam is nu ${name}.`;
      }
      case 'status':
        if (!match) return noMatch;
        return this.standText(match);
      case 'historiek':
        return this.historyText();
      case 'help':
        return this.config.testmodus ? `${HELP}\n\n${TEST_HELP}` : HELP;
      case 'test':
        if (this.config.testmodus) return this.handleTest(arg.toLowerCase(), match);
        return `Onbekend commando. ${HELP}`;
      default:
        return `Onbekend commando. ${HELP}`;
    }
  }

  /** Testcommando's: de stappen van de planning nu uitvoeren (alleen met "Test mode" aan). */
  async handleTest(sub, match) {
    const noMatch = 'Er is geen wedstrijd aangekondigd. Begin met !test aankondigen.';
    switch (sub) {
      case 'aankondigen': {
        if (match) return `Er is al een wedstrijd aangekondigd (${formatDateNl(match.date)}). Gebruik eerst !test afsluiten.`;
        let date = nextMatchDate(this.now().date);
        while (this.state.matches[date]) date = nextMatchDate(addDays(date, 1)); // volgende vrije speeldag
        await this.announce(date);
        return null;
      }
      case 'dinsdag':
        if (!match) return noMatch;
        match.flags.status = true;
        this.store.save();
        if (!(await this.sendStatus(match))) return 'Test: het team is volledig, dus op dinsdag komt er geen bericht.';
        return null;
      case 'herhaling':
        if (!match) return noMatch;
        match.flags.eve = true;
        this.store.save();
        await this.sendEve(match);
        return null;
      case 'afsluiten': {
        if (!match) return noMatch;
        this.finalize(match);
        return match.status === 'played'
          ? `Test: de wedstrijd van ${formatDateNl(match.date)} is afgesloten en gespeeld door ${listNl(this.teamNames(match.team))}.`
          : `Test: de wedstrijd van ${formatDateNl(match.date)} is afgesloten zonder 4 spelers en telt niet mee.`;
      }
      case 'wissen':
        this.state.matches = {};
        this.store.save();
        return 'Test: alle wedstrijden en de historiek zijn gewist. De ledenlijst blijft behouden.';
      default:
        return TEST_HELP;
    }
  }

  historyText() {
    const all = Object.values(this.state.matches)
      .filter((m) => m.status !== 'open')
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!all.length) return 'Nog geen wedstrijden in de historiek.';
    const lines = ['📜 Speelhistoriek'];
    for (const m of all) {
      const d = formatShortNl(m.date);
      if (m.status === 'played') lines.push(`• ${d}: ${listNl(this.teamNames(m.team))}`);
      else if (m.status === 'cancelled') lines.push(`• ${d}: niet doorgegaan`);
      else lines.push(`• ${d}: geen 4 spelers`);
    }
    // Totalen per speler over alle gespeelde wedstrijden
    const totals = {};
    for (const m of all.filter((x) => x.status === 'played')) {
      for (const pid of m.team.members) totals[pid] = (totals[pid] || 0) + 1;
    }
    const rows = Object.entries(totals)
      .map(([pid, n]) => ({ name: this.displayName(pid), n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'nl'));
    if (rows.length) {
      lines.push('', 'Totaal gespeeld:');
      for (const r of rows) lines.push(`• ${r.name}: ${r.n}`);
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- onderhoud

  async checkTopup(now) {
    const last = this.config.laatste_herlading;
    if (!last || now.time < this.config.tijdstip) return;
    const expiry = addMonths(last, Number(this.config.geldigheid_maanden) || 9);
    const left = daysBetween(now.date, expiry);
    const sent = this.state.topup.sent;
    const due = TOPUP_THRESHOLDS.filter((t) => left <= t && !sent[`${expiry}:${t}`]);
    if (!due.length) return;
    for (const t of TOPUP_THRESHOLDS) if (left <= t) sent[`${expiry}:${t}`] = true;
    this.store.save();
    const when = left > 0 ? `binnen ${left} dag${left === 1 ? '' : 'en'}` : 'nu';
    await this.notify(
      'Padelbot: eSIM herladen',
      `Het botnummer moet ${when} herladen worden (laatste herlading: ${last}, nummer geldig tot ${expiry}). ` +
      'Herlaad met het kleinste bedrag (bij DIGI: €5 via MyDIGI) en vul daarna de nieuwe datum in bij ' +
      '"Laatste herlading eSIM" in de instellingen van de Padelbot-App.'
    );
  }
}

function cleanName(s) {
  return (s || '').replace(/[*_~`]/g, '').trim().slice(0, 30);
}

export const HELP = [
  'Commando\'s:',
  '• !gast Marc – gastspeler toevoegen',
  '• !gast weg Marc – gastspeler verwijderen',
  '• !geen – de wedstrijd gaat niet door',
  '• !status – stand van de volgende wedstrijd',
  '• !naam Jan – je naam in de berichten instellen',
  '• !historiek – alle vorige wedstrijden',
  '• !help – deze lijst'
].join('\n');

export const TEST_HELP = [
  'Testcommando\'s (Test mode staat aan):',
  '• !test aankondigen – aankondiging en peiling nu',
  '• !test dinsdag – bericht van dinsdag nu (als het team niet volledig is)',
  '• !test herhaling – herhaling van de dag vóór de wedstrijd nu',
  '• !test afsluiten – wedstrijd nu afsluiten',
  '• !test wissen – alle wedstrijden en historiek wissen'
].join('\n');
