// Startpunt van de Padelbot-App.
import path from 'node:path';
import { Bot } from './bot.js';
import { loadConfig } from './config.js';
import { makeNotifier } from './notify.js';
import { Store } from './store.js';
import { startWeb } from './web.js';
import { WhatsApp } from './whatsapp.js';

const DATA_DIR = process.env.PADELBOT_DATA || '/data';
const log = {
  info: (...a) => console.log(new Date().toISOString(), 'INFO', ...a),
  warn: (...a) => console.warn(new Date().toISOString(), 'WARN', ...a),
  error: (...a) => console.error(new Date().toISOString(), 'FOUT', ...a)
};

const config = loadConfig();
const store = new Store(path.join(DATA_DIR, 'padelbot.json'));
const notify = makeNotifier(config.melding_service, log);

// Alle gebeurtenissen één voor één verwerken, zodat stemmen en commando's elkaar niet storen.
let queue = Promise.resolve();
const serial = (fn) => {
  queue = queue.then(fn).catch((err) => log.error(err));
  return queue;
};

let bot;
const wa = new WhatsApp({
  authDir: path.join(DATA_DIR, 'auth'),
  groupName: config.groep_naam,
  pairingNumber: config.bot_telefoonnummer,
  log,
  handlers: {
    notify,
    pollSecret: (id) => bot.pollSecret(id),
    onReady: () => serial(() => bot.tick()),
    onMembersChanged: (participants) => serial(() => bot.syncMembers(participants)),
    onVote: (vote) => serial(() => bot.handleVote(vote)),
    onText: (msg) => serial(async () => {
      const isCommand = msg.text.trim().startsWith('!');
      if (isCommand) log.info(`Commando ${msg.text.trim().split(/\s+/)[0]} van ${msg.pushName || msg.senderIds[0]}`);
      const reply = await bot.handleCommand(msg);
      if (reply) {
        await wa.sendText(reply);
        log.info('Antwoord verstuurd');
      }
    })
  },
  debug: !!config.uitgebreide_log
});

bot = new Bot({ store, config, wa, notify, log });

startWeb({ wa, bot, config, log });

if (!config.groep_naam) log.warn('Vul de naam van de WhatsApp-groep in bij de instellingen van de App.');
log.info(`Padelbot gestart (berichten om ${config.tijdstip}, tijdzone ${config.tijdzone})`);

await wa.start();

// Elke minuut nakijken of er een gepland bericht klaar staat.
setInterval(() => serial(async () => {
  await wa.checkLongDisconnect();
  if (wa.isReady()) await bot.tick();
}), 60 * 1000);
