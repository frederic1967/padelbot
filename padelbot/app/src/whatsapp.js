// Verbinding met WhatsApp (als gekoppeld apparaat van het bot-account) via Baileys.
import crypto from 'node:crypto';
import fs from 'node:fs';
import pino from 'pino';
import makeWASocket, {
  Browsers, DisconnectReason, decryptPollVote, fetchLatestBaileysVersion, isJidGroup,
  jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState
} from 'baileys';

const RECONNECT_ALERT_MS = 30 * 60 * 1000;

export class WhatsApp {
  /**
   * @param {object} opts
   * @param {string} opts.authDir map voor de koppelgegevens
   * @param {string} opts.groupName exacte naam van de WhatsApp-groep
   * @param {string} [opts.pairingNumber] telefoonnummer van de bot, voor een koppelcode i.p.v. QR
   * @param {object} opts.handlers { onReady, onVote(vote), onText(msg), onMembersChanged, pollSecret(id), notify(title, msg) }
   * @param {object} opts.log
   */
  constructor({ authDir, groupName, pairingNumber, handlers, log }) {
    Object.assign(this, { authDir, groupName, pairingNumber, handlers, log });
    this.sock = null;
    this.groupJid = null;
    this.status = { connection: 'starten', qr: null, pairingCode: null, me: null, group: null, error: null };
    this.disconnectedSince = null;
    this.alertSent = false;
  }

  isReady() {
    return this.status.connection === 'verbonden' && !!this.groupJid;
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // Baileys gebruikt dan zijn ingebouwde versie
    }
    const sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('Chrome'),
      logger: pino({ level: 'warn' }),
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    this.sock = sock;
    this.pairingRequested = false;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u).catch((e) => this.fail(e)));
    sock.ev.on('messages.upsert', (u) => this.onMessages(u).catch((e) => this.fail(e)));
    sock.ev.on('group-participants.update', (u) => {
      if (u.id === this.groupJid) this.syncMembers().catch((e) => this.fail(e));
    });
  }

  fail(err) {
    this.status.error = err?.message || String(err);
    this.log.error(err);
  }

  async onConnectionUpdate({ connection, lastDisconnect, qr }) {
    if (qr) {
      this.status.connection = 'wacht op koppeling';
      this.status.qr = qr;
      if (this.pairingNumber && !this.pairingRequested) {
        this.pairingRequested = true;
        const digits = this.pairingNumber.replace(/\D/g, '');
        this.status.pairingCode = await this.sock.requestPairingCode(digits);
      }
    }
    if (connection === 'open') {
      Object.assign(this.status, { connection: 'verbonden', qr: null, pairingCode: null, error: null });
      this.status.me = this.sock.user?.id ? `+${jidNormalizedUser(this.sock.user.id).split('@')[0]}` : null;
      this.disconnectedSince = null;
      this.alertSent = false;
      await this.findGroup();
      await this.syncMembers();
      await this.handlers.onReady();
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      this.status.connection = 'verbroken';
      this.disconnectedSince ??= Date.now();
      if (code === DisconnectReason.loggedOut) {
        // Het apparaat werd ontkoppeld: koppelgegevens wissen en opnieuw een QR-code tonen.
        this.log.warn('Uitgelogd door WhatsApp, opnieuw koppelen nodig');
        fs.rmSync(this.authDir, { recursive: true, force: true });
        await this.handlers.notify(
          'Padelbot: WhatsApp-koppeling verbroken',
          'De bot is uitgelogd. Open de Padelbot-App in Home Assistant en koppel opnieuw met de QR-code.'
        );
        this.alertSent = true;
      }
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.start().catch((e) => this.fail(e));
        }, code === DisconnectReason.loggedOut ? 2000 : 5000);
      }
    }
  }

  /** Waarschuw eenmalig als de verbinding al lang weg is (aangeroepen door de planner). */
  async checkLongDisconnect() {
    if (this.disconnectedSince && !this.alertSent && Date.now() - this.disconnectedSince > RECONNECT_ALERT_MS) {
      this.alertSent = true;
      await this.handlers.notify(
        'Padelbot: geen verbinding',
        'De bot heeft al 30 minuten geen verbinding met WhatsApp. Kijk in de Padelbot-App in Home Assistant.'
      );
    }
  }

  async findGroup() {
    const groups = await this.sock.groupFetchAllParticipating();
    const wanted = this.groupName.trim().toLowerCase();
    const found = Object.values(groups).find((g) => (g.subject || '').trim().toLowerCase() === wanted);
    this.groupJid = found ? found.id : null;
    this.status.group = found ? found.subject : null;
    if (!found) {
      this.status.error = `Groep "${this.groupName}" niet gevonden. Is het botnummer lid van de groep en klopt de naam?`;
    }
  }

  meIds() {
    const u = this.sock.user || {};
    return [u.id, u.lid].filter(Boolean).map((j) => jidNormalizedUser(j));
  }

  async syncMembers() {
    if (!this.groupJid) return;
    const meta = await this.sock.groupMetadata(this.groupJid);
    const me = this.meIds();
    const participants = meta.participants
      .map((p) => ({ ids: [p.id, p.lid, p.phoneNumber].filter(Boolean).map((j) => jidNormalizedUser(j)) }))
      .filter((p) => !p.ids.some((id) => me.includes(id)));
    await this.handlers.onMembersChanged(participants);
  }

  async sendText(text) {
    if (!this.isReady()) throw new Error('Niet verbonden met de groep');
    await this.sock.sendMessage(this.groupJid, { text });
  }

  async sendPoll(name, values) {
    if (!this.isReady()) throw new Error('Niet verbonden met de groep');
    const secret = crypto.randomBytes(32);
    const msg = await this.sock.sendMessage(this.groupJid, {
      poll: { name, values, selectableCount: 1, messageSecret: secret }
    });
    return { id: msg.key.id, secret: secret.toString('hex') };
  }

  async onMessages({ messages, type }) {
    for (const msg of messages) {
      if (!msg.key?.remoteJid || msg.key.remoteJid !== this.groupJid || !isJidGroup(msg.key.remoteJid)) continue;
      const content = normalizeMessageContent(msg.message);
      if (!content) continue;
      const senderIds = [msg.key.participant, msg.key.participantAlt].filter(Boolean).map((j) => jidNormalizedUser(j));

      if (content.pollUpdateMessage) {
        const vote = this.decryptVote(msg, content.pollUpdateMessage, senderIds);
        if (vote) await this.handlers.onVote({ ...vote, senderIds, pushName: msg.pushName });
        continue;
      }
      if (type !== 'notify' || msg.key.fromMe) continue;
      const text = content.conversation || content.extendedTextMessage?.text;
      if (text) await this.handlers.onText({ senderIds, pushName: msg.pushName, text });
    }
  }

  decryptVote(msg, update, senderIds) {
    const pollId = update.pollCreationMessageKey?.id;
    const secretHex = pollId && this.handlers.pollSecret(pollId);
    if (!secretHex) return null;
    const pollEncKey = Buffer.from(secretHex, 'hex');
    // Afhankelijk van de groep gebruikt WhatsApp telefoonnummers of "LID"-ids; probeer beide.
    for (const pollCreatorJid of this.meIds()) {
      for (const voterJid of senderIds) {
        try {
          const vote = decryptPollVote(update.vote, { pollCreatorJid, pollMsgId: pollId, pollEncKey, voterJid });
          const selectedHashes = (vote.selectedOptions || []).map((b) => Buffer.from(b).toString('hex'));
          return { pollId, selectedHashes };
        } catch {
          // volgende combinatie proberen
        }
      }
    }
    this.log.warn(`Stem in peiling ${pollId} kon niet ontsleuteld worden`);
    return null;
  }
}
