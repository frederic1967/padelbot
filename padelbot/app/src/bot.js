// De logica van de padelbot, los van WhatsApp zelf (zodat ze getest kan worden).
import crypto from 'node:crypto';
import {
  addDays, addMonths, atOrAfter, daysBetween, formatDateNl, formatShortNl, localNow, nextMatchDate, planFor
} from './schedule.js';
import { applyVote, computeTeam, confirmText, describeChange, listNl, missingText } from './team.js';

export const YES = '✅ Ja';
export const NO = '❌ Nee';
const YES_HASH = crypto.createHash('sha256').update(YES).digest('hex');
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
      dateText: formatDateNl(match.date),
      reservedBy: match.reservedBy
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
      reservedBy: null,
      // Te laat aangekondigd (bv. Pi stond uit)? Dan geen dubbele berichten achteraf.
      flags: { announced: false, status: atOrAfter(now, plan.status), reminder: atOrAfter(now, plan.reminder) },
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

  async sendStatus(match) {
    const team = computeTeam(match);
    const dateText = formatDateNl(match.date);
    if (team.complete) {
      await this.wa.sendText(confirmText(this.teamNames(team), dateText, match.reservedBy));
    } else {
      await this.wa.sendText(
        `⚠️ Voor ${dateText} ${missingText(team.missing)}. Wie kan er nog? ` +
        'Stem in de peiling hierboven, of voeg een gast toe met !gast naam.'
      );
    }
  }

  async sendReminder(match) {
    const team = computeTeam(match);
    if (team.complete) return;
    await this.wa.sendText(
      `⏰ Herinnering: voor ${formatDateNl(match.date)} ${missingText(team.missing)}. ` +
      'Stem in de peiling, of voeg een gast toe met !gast naam.'
    );
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

    // 2. Volgende wedstrijd aankondigen op de dinsdag, 8 dagen vooraf.
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

    // 3. Woensdag: bevestiging of "er ontbreken nog spelers".
    const plan = planFor(match.date, this.config.tijdstip);
    if (!match.flags.status && atOrAfter(now, plan.status)) {
      match.flags.status = true;
      this.store.save();
      await this.sendStatus(match);
    }
    // 4. Donderdag: één herinnering als het team niet volledig is.
    if (!match.flags.reminder && atOrAfter(now, plan.reminder)) {
      match.flags.reminder = true;
      this.store.save();
      await this.sendReminder(match);
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
    const saysYes = selectedHashes.includes(YES_HASH);
    await this.changeMatch(match, (m) => { m.yesOrder = applyVote(m.yesOrder, pid, saysYes); });
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
          return `${existing} (gast) is van de lijst gehaald.`;
        }
        if (existing) return `${existing} staat al als gast op de lijst.`;
        const wasComplete = computeTeam(match).complete;
        await this.changeMatch(match, (m) => { m.guests.push(guest); });
        if (wasComplete) return `Het team is al volledig. ${guest} (gast) staat klaar als reserve.`;
        return computeTeam(match).complete ? null : `${guest} (gast) speelt mee. Voor ${formatDateNl(match.date)} ${missingText(computeTeam(match).missing)}.`;
      }
      case 'gereserveerd': {
        if (!match) return noMatch;
        match.reservedBy = this.displayName(pid);
        this.store.save();
        return `✅ Terrein gereserveerd door ${match.reservedBy}.`;
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
      case 'status': {
        if (!match) return noMatch;
        const team = computeTeam(match);
        const lines = [`🎾 Wedstrijd van ${formatDateNl(match.date)}`];
        lines.push(`Team: ${team.members.length + team.guests.length ? listNl(this.teamNames(team)) : 'nog niemand'}`);
        if (!team.complete) lines.push(`Er ${missingText(team.missing)}.`);
        if (team.reserves.length) lines.push(`Reserves: ${listNl(team.reserves.map((p) => this.displayName(p)))}`);
        if (team.spareGuests.length) lines.push(`Gasten in reserve: ${listNl(team.spareGuests)}`);
        lines.push(match.reservedBy ? `Terrein gereserveerd door ${match.reservedBy}.` : 'Terrein: nog niet gereserveerd.');
        return lines.join('\n');
      }
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
      case 'woensdag':
        if (!match) return noMatch;
        match.flags.status = true;
        this.store.save();
        await this.sendStatus(match);
        return null;
      case 'donderdag':
        if (!match) return noMatch;
        match.flags.reminder = true;
        this.store.save();
        if (computeTeam(match).complete) return 'Test: het team is volledig, dus op donderdag komt er geen herinnering.';
        await this.sendReminder(match);
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
  '• !gereserveerd – het terrein is gereserveerd',
  '• !geen – de wedstrijd gaat niet door',
  '• !status – stand van de volgende wedstrijd',
  '• !naam Jan – je naam in de berichten instellen',
  '• !historiek – alle vorige wedstrijden',
  '• !help – deze lijst'
].join('\n');

export const TEST_HELP = [
  'Testcommando\'s (Test mode staat aan):',
  '• !test aankondigen – aankondiging en peiling nu',
  '• !test woensdag – bericht van woensdag nu',
  '• !test donderdag – herinnering van donderdag nu',
  '• !test afsluiten – wedstrijd nu afsluiten',
  '• !test wissen – alle wedstrijden en historiek wissen'
].join('\n');
