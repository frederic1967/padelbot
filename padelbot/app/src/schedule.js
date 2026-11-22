// Datums en tijdstippen. Alle datums zijn strings 'YYYY-MM-DD', tijden 'HH:MM',
// steeds in de lokale tijdzone van de groep (standaard Europe/Brussels).

const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

const pad = (n) => String(n).padStart(2, '0');

function toUtcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(dateStr, days) {
  const dt = toUtcDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtcDate(dt);
}

/** Tel maanden op; valt de dag weg (bv. 31 mei + 9 maanden), dan de laatste dag van die maand. */
export function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUtcDate(target);
}

/** De 1e en 3e woensdag van een maand (month: 1-12). */
export function matchDatesInMonth(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (3 - first.getUTCDay() + 7) % 7; // 3 = woensdag
  const firstWed = fromUtcDate(new Date(Date.UTC(year, month - 1, 1 + offset)));
  return [firstWed, addDays(firstWed, 14)];
}

/** Eerste speeldag op of na de gegeven datum. */
export function nextMatchDate(fromDate) {
  let [y, m] = fromDate.split('-').map(Number);
  for (let i = 0; i < 3; i++) {
    for (const d of matchDatesInMonth(y, m)) {
      if (d >= fromDate) return d;
    }
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  throw new Error(`Geen speeldag gevonden na ${fromDate}`);
}

/** Huidige lokale datum en tijd in de gegeven tijdzone. */
export function localNow(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "woensdag 2 december" */
export function formatDateNl(dateStr) {
  const dt = toUtcDate(dateStr);
  return `${DAGEN[dt.getUTCDay()]} ${dt.getUTCDate()} ${MAANDEN[dt.getUTCMonth()]}`;
}

/** "2 dec 2026" (kort, voor de historiek) */
export function formatShortNl(dateStr) {
  const dt = toUtcDate(dateStr);
  return `${dt.getUTCDate()} ${MAANDEN[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCFullYear()}`;
}

/** Tijdstippen van de berichten rond een speeldag. */
export function planFor(matchDate, tijdstip) {
  return {
    announce: { date: addDays(matchDate, -9), time: tijdstip }, // maandag, 9 dagen vooraf
    status: { date: addDays(matchDate, -8), time: tijdstip },   // dinsdag, 8 dagen vooraf
    eve: { date: addDays(matchDate, -1), time: tijdstip },      // dag vóór de wedstrijd
    finalize: { date: matchDate, time: '23:00' }                // speeldag, 's avonds
  };
}

/** Is moment `a` ({date,time}) gelijk aan of later dan `b`? */
export function atOrAfter(a, b) {
  return `${a.date} ${a.time}` >= `${b.date} ${b.time}`;
}

export function daysBetween(fromDate, toDate) {
  return Math.round((toUtcDate(toDate) - toUtcDate(fromDate)) / 86400000);
}
