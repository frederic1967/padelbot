import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays, addMonths, atOrAfter, formatDateNl, localNow, matchDatesInMonth, nextMatchDate, planFor
} from '../src/schedule.js';

test('1e en 3e woensdag van de maand', () => {
  assert.deepEqual(matchDatesInMonth(2026, 12), ['2026-12-02', '2026-12-16']);
  assert.deepEqual(matchDatesInMonth(2026, 11), ['2026-11-04', '2026-11-18']);
  assert.deepEqual(matchDatesInMonth(2027, 1), ['2027-01-06', '2027-01-20']);
  // Maand die op een woensdag begint
  assert.deepEqual(matchDatesInMonth(2026, 4), ['2026-04-01', '2026-04-15']);
});

test('volgende speeldag', () => {
  assert.equal(nextMatchDate('2026-11-21'), '2026-12-02');
  assert.equal(nextMatchDate('2026-12-02'), '2026-12-02');
  assert.equal(nextMatchDate('2026-12-17'), '2027-01-06'); // over de jaarwissel
});

test('planning: dinsdag, woensdag, donderdag vooraf', () => {
  const p = planFor('2026-12-02', '18:00');
  assert.deepEqual(p.announce, { date: '2026-11-24', time: '18:00' });
  assert.equal(formatDateNl(p.announce.date), 'dinsdag 24 november');
  assert.equal(formatDateNl(p.status.date), 'woensdag 25 november');
  assert.equal(formatDateNl(p.reminder.date), 'donderdag 26 november');
  assert.equal(formatDateNl('2026-12-02'), 'woensdag 2 december');
});

test('de aankondiging valt altijd op een dinsdag', () => {
  for (let y = 2026; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      for (const d of matchDatesInMonth(y, m)) {
        assert.match(formatDateNl(planFor(d, '18:00').announce.date), /^dinsdag /);
      }
    }
  }
});

test('lokale tijd in Brussel, ook rond de zomertijd', () => {
  assert.deepEqual(localNow('Europe/Brussels', new Date('2026-11-24T17:00:00Z')), { date: '2026-11-24', time: '18:00' });
  assert.deepEqual(localNow('Europe/Brussels', new Date('2026-07-07T16:00:00Z')), { date: '2026-07-07', time: '18:00' });
});

test('tijdvergelijking en dagen optellen', () => {
  assert.ok(atOrAfter({ date: '2026-11-24', time: '18:00' }, { date: '2026-11-24', time: '18:00' }));
  assert.ok(!atOrAfter({ date: '2026-11-24', time: '17:59' }, { date: '2026-11-24', time: '18:00' }));
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
});

test('maanden optellen (geldigheid eSIM)', () => {
  assert.equal(addMonths('2026-11-22', 9), '2027-08-22');
  assert.equal(addMonths('2026-05-31', 9), '2027-02-28'); // korte maand
  assert.equal(addMonths('2026-03-20', 9), '2026-12-20');
});
