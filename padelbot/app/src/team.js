// Teamvorming: de eerste 4 groepsleden die ✅ stemmen spelen. Gasten vullen
// lege plaatsen aan. Groepsleden hebben altijd voorrang op gasten.

export const TEAM_SIZE = 4;

/**
 * @param {{yesOrder: string[], guests: string[]}} match
 * @returns {{members: string[], guests: string[], reserves: string[], spareGuests: string[], complete: boolean, missing: number}}
 */
export function computeTeam(match) {
  const yes = match.yesOrder || [];
  const guests = match.guests || [];
  const members = yes.slice(0, TEAM_SIZE);
  const reserves = yes.slice(TEAM_SIZE);
  const free = TEAM_SIZE - members.length;
  const teamGuests = guests.slice(0, free);
  const spareGuests = guests.slice(free);
  const size = members.length + teamGuests.length;
  return {
    members,
    guests: teamGuests,
    reserves,
    spareGuests,
    complete: size === TEAM_SIZE,
    missing: TEAM_SIZE - size
  };
}

/** Werk de volgorde van ✅-stemmen bij voor één speler. */
export function applyVote(yesOrder, personId, saysYes) {
  const list = yesOrder.filter((id) => id !== personId);
  if (saysYes) {
    // Wie al op ✅ stond, behoudt zijn plaats; wie nieuw ✅ stemt, sluit achteraan aan.
    if (yesOrder.includes(personId)) return yesOrder.slice();
    list.push(personId);
  }
  return list;
}

/**
 * Vergelijk het team voor en na een wijziging en geef de meldingen terug.
 * `name(id)` geeft de naam van een groepslid; gasten zijn al namen.
 */
export function describeChange(before, after, { name, dateText, reservedBy }) {
  const msgs = [];
  const teamNames = (t) => [...t.members.map(name), ...t.guests.map((g) => `${g} (gast)`)];
  const inList = (arr, x) => arr.includes(x);

  const outMembers = before.members.filter((id) => !inList(after.members, id));
  const inMembers = after.members.filter((id) => !inList(before.members, id));
  const outGuests = before.guests.filter((g) => !inList(after.guests, g));
  const inGuests = after.guests.filter((g) => !inList(before.guests, g));

  if (!before.complete && after.complete) {
    msgs.push(confirmText(teamNames(after), dateText, reservedBy));
  } else if (before.complete && after.complete) {
    const outs = [...outMembers.map(name), ...outGuests.map((g) => `${g} (gast)`)];
    const ins = [...inMembers.map(name), ...inGuests.map((g) => `${g} (gast)`)];
    if (outs.length || ins.length) {
      const lines = [];
      // Een gast die plaats moet maken voor een groepslid
      const bumpedGuests = (inMembers.length > 0 && outMembers.length === 0) ? outGuests : [];
      if (bumpedGuests.length) {
        lines.push(`🔄 ${listNl(inMembers.map(name))} speelt mee, dus ${listNl(bumpedGuests)} (gast) is niet meer nodig.`);
      } else {
        const who = listNl(outs);
        lines.push(`🔄 ${who} ${outs.length > 1 ? 'haken' : 'haakt'} af, ${listNl(ins)} ${ins.length > 1 ? 'spelen' : 'speelt'} mee.`);
      }
      lines.push(`Team voor ${dateText}: ${listNl(teamNames(after))}.`);
      msgs.push(lines.join('\n'));
    }
  } else if (before.complete && !after.complete) {
    const outs = [...outMembers.map(name), ...outGuests.map((g) => `${g} (gast)`)];
    msgs.push(
      `⚠️ ${listNl(outs)} ${outs.length > 1 ? 'haken' : 'haakt'} af. ` +
      `Voor ${dateText} ${missingText(after.missing)}. ` +
      'Wie kan er nog? Stem in de peiling, of voeg een gast toe met !gast naam.'
    );
  }

  // Nieuwe reserves (alleen groepsleden die ✅ stemden terwijl het team al vol was)
  after.reserves.forEach((id, idx) => {
    if (!before.reserves.includes(id) && !before.members.includes(id)) {
      msgs.push(`Het team is al volledig. ${name(id)}, je staat op de reservelijst (${idx + 1}e reserve).`);
    }
  });
  return msgs;
}

export function confirmText(names, dateText, reservedBy) {
  const tail = reservedBy
    ? `Het terrein is gereserveerd door ${reservedBy}.`
    : 'Wie reserveert het terrein? Typ !gereserveerd als het geregeld is.';
  return `✅ Het team voor ${dateText} staat vast: ${listNl(names)}.\n${tail}`;
}

export function missingText(n) {
  return n === 1 ? 'ontbreekt nog 1 speler' : `ontbreken nog ${n} spelers`;
}

/** "A, B en C" */
export function listNl(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
}
