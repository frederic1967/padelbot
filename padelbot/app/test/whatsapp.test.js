// Controleert dat een stem, versleuteld zoals WhatsApp dat doet, correct ontsleuteld wordt.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { aesEncryptGCM, hmacSign, proto } from 'baileys';
import { YES } from '../src/bot.js';
import { WhatsApp } from '../src/whatsapp.js';

function encryptVote({ secret, pollMsgId, pollCreatorJid, voterJid, option }) {
  const sign = Buffer.concat([
    Buffer.from(pollMsgId), Buffer.from(pollCreatorJid), Buffer.from(voterJid),
    Buffer.from('Poll Vote'), new Uint8Array([1])
  ]);
  const key0 = hmacSign(secret, new Uint8Array(32), 'sha256');
  const decKey = hmacSign(sign, key0, 'sha256');
  const iv = crypto.randomBytes(12);
  const plain = proto.Message.PollVoteMessage.encode({
    selectedOptions: [crypto.createHash('sha256').update(option).digest()]
  }).finish();
  const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`);
  return { encPayload: aesEncryptGCM(plain, decKey, iv, aad), encIv: iv };
}

function makeWa(secret) {
  const wa = new WhatsApp({
    authDir: '/tmp/x', groupName: 'Test', log: { info() {}, warn() {}, error() {} },
    handlers: { pollSecret: (id) => (id === 'POLL1' ? secret.toString('hex') : null) }
  });
  wa.sock = { user: { id: '32470000000:5@s.whatsapp.net', lid: '999:5@lid' } };
  return wa;
}

test('stem ontsleutelen in een groep met LID-adressering', () => {
  const secret = crypto.randomBytes(32);
  const wa = makeWa(secret);
  const vote = encryptVote({ secret, pollMsgId: 'POLL1', pollCreatorJid: '999@lid', voterJid: '555@lid', option: YES });
  const res = wa.decryptVote({}, { pollCreationMessageKey: { id: 'POLL1' }, vote }, ['555@lid', '32471111111@s.whatsapp.net']);
  assert.deepEqual(res.selectedHashes, [crypto.createHash('sha256').update(YES).digest('hex')]);
});

test('stem ontsleutelen in een groep met telefoonnummers', () => {
  const secret = crypto.randomBytes(32);
  const wa = makeWa(secret);
  const vote = encryptVote({ secret, pollMsgId: 'POLL1', pollCreatorJid: '32470000000@s.whatsapp.net', voterJid: '32471111111@s.whatsapp.net', option: YES });
  const res = wa.decryptVote({}, { pollCreationMessageKey: { id: 'POLL1' }, vote }, ['555@lid', '32471111111@s.whatsapp.net']);
  assert.equal(res.selectedHashes.length, 1);
});

test('stem op een onbekende peiling wordt genegeerd', () => {
  const wa = makeWa(crypto.randomBytes(32));
  assert.equal(wa.decryptVote({}, { pollCreationMessageKey: { id: 'ANDER' }, vote: {} }, ['x@lid']), null);
});
