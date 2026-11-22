// Statuspagina in Home Assistant (via "Ingress"): verbinding, QR-code en volgende wedstrijd.
import http from 'node:http';
import QRCode from 'qrcode';
import { formatDateNl } from './schedule.js';
import { computeTeam, listNl } from './team.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function startWeb({ port = 8099, wa, bot, config, log }) {
  const server = http.createServer(async (req, res) => {
    try {
      const html = await renderPage({ wa, bot, config });
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

async function renderPage({ wa, bot, config }) {
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
    } else {
      parts.push('<p>Er is nu geen wedstrijd aangekondigd. De volgende aankondiging volgt op de maandag, 9 dagen voor de speeldag, om ' + esc(config.tijdstip) + '.</p>');
    }
  }
  if (s.error) parts.push(`<p class="err"><b>Let op:</b> ${esc(s.error)}</p>`);

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Padelbot</title><style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1f2933}
h1{font-size:1.4rem}.err{color:#b42318}.code{font-size:2rem;letter-spacing:.2em;font-weight:700}
img{border:1px solid #ddd;border-radius:8px}
</style></head><body><h1>🎾 Padelbot</h1>${parts.join('\n')}</body></html>`;
}
