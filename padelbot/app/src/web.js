// Statuspagina in Home Assistant (via "Ingress"): verbinding, QR-code en volgende wedstrijd.
import http from 'node:http';
import QRCode from 'qrcode';
import { formatDateNl } from './schedule.js';
import { computeTeam, listNl } from './team.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} opts
 * @param {(fn: () => any) => Promise<any>} [opts.run] voert wijzigingen uit in de wachtrij van de bot
 */
export function startWeb({ port = 8099, wa, bot, config, log, run = (fn) => Promise.resolve(fn()) }) {
  const server = http.createServer(async (req, res) => {
    try {
      let notice = '';
      if (req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const names = {};
        const votes = {};
        for (const [key, value] of form) {
          if (key.startsWith('naam:')) names[key.slice(5)] = value;
          if (key.startsWith('stem:')) votes[key.slice(5)] = value;
        }
        if (Object.keys(votes).length) {
          await run(() => bot.setVotesAdmin(votes));
          notice = '✅ Stand aangepast.';
        } else {
          await run(() => bot.setNames(names));
          notice = '✅ Namen opgeslagen.';
          log.info('Namen van de leden bijgewerkt via de statuspagina');
        }
      }
      const html = await renderPage({ wa, bot, config, notice });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (err) {
      log.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Fout bij het tonen van de status');
    }
  });
  server.listen(port, '0.0.0.0', () => log.info(`Statuspagina op poort ${port}`));
  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100000) { reject(new Error('Te groot')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Stand van de lopende wedstrijd aanpassen: per lid "kan spelen", "kan niet" of "geen antwoord". */
function votesForm(bot, match, notice) {
  const team = computeTeam(match);
  const role = (pid) => (team.members.includes(pid) ? 'speelt'
    : team.reserves.includes(pid) ? `${team.reserves.indexOf(pid) + 1}e reserve` : '');
  const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  const rows = bot.activeMembers()
    .map((pid) => ({ pid, name: bot.displayName(pid) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
    .map(({ pid, name }) => {
      const current = bot.currentVote(match, pid);
      return `
    <tr>
      <td>${esc(name)}${role(pid) ? `<br><small>${esc(role(pid))}</small>` : ''}</td>
      <td><select name="stem:${esc(pid)}">${option('yes', '✅ Kan spelen', current)}${option('no', '❌ Kan niet', current)}${option('', '– Geen antwoord', current)}</select></td>
    </tr>`;
    }).join('');
  return `<h2>Stand aanpassen</h2>
<p>Meldde iemand zich af buiten de peiling? Zet die persoon op <b>❌ Kan niet</b>: de eerste reserve schuift dan door. Er komt geen bericht in de groep.</p>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post">
<table>${rows}</table>
<button type="submit">Stand opslaan</button>
</form>`;
}

/** Ledenlijst met een invulvakje per lid, om de namen in te stellen. */
function membersForm(bot, notice) {
  const rows = bot.memberList().map((m) => `
    <tr>
      <td>${m.phone ? esc(m.phone) : '<i>nummer onbekend</i>'}${m.profileName ? `<br><small>WhatsApp: ${esc(m.profileName)}</small>` : ''}</td>
      <td><input name="naam:${esc(m.pid)}" value="${esc(m.customName)}" placeholder="${esc(m.profileName || 'voornaam')}" maxlength="30"></td>
    </tr>`).join('');
  return `<h2>Leden van de groep</h2>
<p>Vul de voornaam in zoals Paddy die moet gebruiken. Laat je een vakje leeg, dan gebruikt Paddy de WhatsApp-profielnaam van die persoon zodra die iets stuurt of stemt.</p>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post">
<table>${rows || '<tr><td>Nog geen leden gevonden.</td></tr>'}</table>
<button type="submit">Opslaan</button>
</form>`;
}

async function renderPage({ wa, bot, config, notice = '' }) {
  const s = wa.status;
  const parts = [];

  parts.push(`<p><b>WhatsApp:</b> ${esc(s.connection)}${s.me ? ` (botnummer ${esc(s.me)})` : ''}</p>`);

  if (s.connection !== 'verbonden' && (s.qr || s.pairingCode)) {
    parts.push('<h2>Koppel de bot</h2>');
    if (s.pairingCode) {
      parts.push(
        `<p class="code">${esc(s.pairingCode)}</p>` +
        '<ol><li>Open WhatsApp en wissel naar het <b>bot-account</b>.</li>' +
        '<li>Ga naar <b>Instellingen → Gekoppelde apparaten → Apparaat koppelen</b>.</li>' +
        '<li>Kies onderaan <b>Koppelen met telefoonnummer</b> en vul de code hierboven in.</li></ol>'
      );
    } else {
      const img = await QRCode.toDataURL(s.qr, { margin: 2, width: 300 });
      parts.push(
        `<img src="${img}" alt="QR-code" width="300" height="300">` +
        '<ol><li>Open WhatsApp en wissel naar het <b>bot-account</b>.</li>' +
        '<li>Ga naar <b>Instellingen → Gekoppelde apparaten → Apparaat koppelen</b>.</li>' +
        '<li>Scan deze QR-code. Ze vernieuwt zichzelf; deze pagina ververst elke 5 seconden.</li></ol>'
      );
    }
  }

  if (s.connection === 'verbonden') {
    parts.push(`<p><b>Groep:</b> ${s.group ? esc(s.group) : `<span class="err">niet gevonden ("${esc(config.groep_naam)}")</span>`}</p>`);
    const match = bot.openMatch();
    if (match) {
      const team = computeTeam(match);
      const names = bot.teamNames(team);
      parts.push(
        `<p><b>Volgende wedstrijd:</b> ${esc(formatDateNl(match.date))}<br>` +
        `<b>Team:</b> ${names.length ? esc(listNl(names)) : 'nog niemand'}${team.complete ? ' ✅' : ` (nog ${team.missing} nodig)`}<br>` +
        `<b>Reserves:</b> ${team.reserves.length ? esc(listNl(team.reserves.map((p) => bot.displayName(p)))) : '–'}</p>`
      );
      parts.push(votesForm(bot, match, notice.startsWith('✅ Stand') ? notice : ''));
    } else {
      parts.push('<p>Er is nu geen wedstrijd aangekondigd. De volgende aankondiging volgt op de maandag, 9 dagen voor de speeldag, om ' + esc(config.tijdstip) + '.</p>');
    }
    if (s.group) parts.push(membersForm(bot, notice.startsWith('✅ Namen') ? notice : ''));
  }
  if (s.error) parts.push(`<p class="err"><b>Let op:</b> ${esc(s.error)}</p>`);

  // Alleen automatisch verversen tijdens het koppelen; anders zou het invullen van namen gewist worden.
  const refresh = s.connection === 'verbonden' ? '' : '<meta http-equiv="refresh" content="5">';
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">
${refresh}<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Padelbot</title><style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1f2933}
h1{font-size:1.4rem}.err{color:#b42318}.code{font-size:2rem;letter-spacing:.2em;font-weight:700}
img{border:1px solid #ddd;border-radius:8px}.ok{color:#067647;font-weight:600}
table{border-collapse:collapse;width:100%}td{padding:6px 4px;border-bottom:1px solid #e5e7eb;vertical-align:middle}
small{color:#6b7280}select{font-size:1rem;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff}input{font-size:1rem;padding:6px 8px;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px}
button{margin-top:12px;font-size:1rem;padding:8px 18px;border:0;border-radius:6px;background:#0B7A63;color:#fff;cursor:pointer}
</style></head><body><h1>🎾 Padelbot</h1>${parts.join('\n')}</body></html>`;
}
