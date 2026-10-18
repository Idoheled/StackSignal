import { AsyncLocalStorage } from 'node:async_hooks';
const inboundRoute = new AsyncLocalStorage();
// Fail-closed policy. Inspect routing metadata before touching message content.
export function requireGroup(target) {
  if (typeof target !== 'string' || !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(target)) throw new Error('Verified fixed group required');
  return target;
}
function accountJid(jid) {
  return typeof jid==='string' ? jid.match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/)?.slice(1).join('@') : undefined;
}
export function allowedFrame(node, target, identities=[]) {
  requireGroup(target);
  const from=node?.attrs?.from;
  if(from===target)return true;
  const account=accountJid(from);
  return Boolean(account&&node?.attrs?.recipient===target&&identities.some(jid=>accountJid(jid)===account));
}
// The vendor's early ignore callback sees `from`, before decoding `recipient`.
// Permit a self address only inside the verified fixed-group frame's async scope.
export function ignoreRoute(jid,target) {
  requireGroup(target);
  if(jid===target)return false;
  const route=inboundRoute.getStore();
  return !(route?.target===target&&route.from===jid);
}
export function questionFrom(envelope, type, target, { now = Date.now(), activatedAt, rejected = () => {} } = {}) {
  requireGroup(target);
  if (envelope?.key?.remoteJid !== target) return null;
  const key = envelope.key;
  const reject=code=>{rejected(code);return null;};
  if (typeof key.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key.id)) return reject('invalid_id');
  if (type !== 'notify' && !(type === 'append' && key.fromMe === true)) return reject('nonlive_upsert');
  const stamp = Number(envelope.messageTimestamp) * 1000;
  if (!Number.isFinite(activatedAt) || !Number.isFinite(stamp) || stamp < activatedAt || stamp < now - 600_000 || stamp > now + 60_000) return reject('stale_timestamp');
  let message = envelope.message;
  for (let i = 0; i < 2 && message?.ephemeralMessage; i++) message = message.ephemeralMessage.message;
  const text = message?.conversation ?? message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || text.length > 4000) return reject(envelope.messageStubType?'ciphertext_stub':'nontext');
  // Mobile RTL composition can prepend invisible direction marks.
  const normalized=text.replace(/^[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]+/u,'');
  const match = normalized.match(/^(columbus|קולומבוס|קולמבוס)(?=$|[\s,:;.!?־–—-])[\s,:;.!?־–—-]*([\s\S]*)$/iu);
  if (!match || match[2].length > 3000) return reject('unmatched_prefix');
  const context = message?.extendedTextMessage?.contextInfo;
  const quotedID = (!context?.remoteJid || context.remoteJid === target) && typeof context?.stanzaId === 'string' ? context.stanzaId.slice(0,128) : null;
  return { id: key.id, sender: key.participant || (key.fromMe ? 'linked-owner' : ''), question: match[2].trim(), quotedID, prefixLanguage:/^columbus$/i.test(match[1])?'en':'he' };
}
export function restrictSocket(sock, target, observe = () => {}) {
  requireGroup(target);
  if(typeof sock.sendMessageAck!=='function')throw new Error('Pinned WhatsApp acknowledgement API unavailable');
  const original = sock.ws.listeners('CB:message');
  if (!original.length) throw new Error('Pinned WhatsApp message boundary unavailable');
  sock.ws.removeAllListeners('CB:message');
  sock.ws.on('CB:message', function(node, ...rest) {
    const me=sock.user||sock.authState?.creds?.me;
    const identities=[me?.id,me?.lid];
    if (!allowedFrame(node, target,identities)) {
      observe('frame_blocked');
      if(node?.attrs?.recipient===target)observe('unrecognized_group_sender');
      if(identities.some(jid=>accountJid(jid)&&accountJid(jid)===accountJid(node?.attrs?.from)))observe(node?.attrs?.recipient?'self_other_recipient':'self_unrouted');
      // Match the pinned vendor's ignored-message NACK without passing the
      // ciphertext or original node to any parser, logger or receive handler.
      const attrs={};
      for(const key of ['id','from','participant','recipient','type'])if(typeof node?.attrs?.[key]==='string'&&node.attrs[key].length<=256)attrs[key]=node.attrs[key];
      if(attrs.id&&attrs.from)void Promise.resolve().then(()=>sock.sendMessageAck({tag:'message',attrs},500))
        .then(()=>observe('blocked_ack_sent')).catch(()=>observe('blocked_ack_failed'));
      return;
    }
    observe(node.attrs.from===target?'frame_group':'frame_self_group');
    inboundRoute.run({target,from:node.attrs.from},()=>{
      for (const listener of original) listener.call(this, node, ...rest);
    });
  });
  for (const name of ['sendMessage', 'relayMessage']) {
    const send = sock[name].bind(sock);
    sock[name] = (jid, ...args) => {
      if (jid !== target) throw new Error('Destination outside StackSignal is blocked');
      return send(jid, ...args);
    };
  }
  // No contact directory, historical-chat requests or cross-group hydration.
  if (sock.groupFetchAllParticipating) sock.groupFetchAllParticipating = async () => ({ [target]: await sock.groupMetadata(target) });
  if (sock.fetchMessageHistory) sock.fetchMessageHistory = async () => { throw new Error('Chat history is disabled'); };
  return sock;
}
