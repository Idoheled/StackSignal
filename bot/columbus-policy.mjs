// Fail-closed policy. Inspect routing metadata before touching message content.
export function requireGroup(target) {
  if (typeof target !== 'string' || !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(target)) throw new Error('Verified fixed group required');
  return target;
}
export function allowedFrame(node, target) {
  return typeof node?.attrs?.from === 'string' && node.attrs.from === requireGroup(target);
}
export function questionFrom(envelope, type, target, { now = Date.now(), activatedAt } = {}) {
  requireGroup(target);
  if (envelope?.key?.remoteJid !== target) return null;
  const key = envelope.key;
  if (typeof key.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key.id)) return null;
  if (type !== 'notify' && !(type === 'append' && key.fromMe === true)) return null;
  const stamp = Number(envelope.messageTimestamp) * 1000;
  if (!Number.isFinite(activatedAt) || !Number.isFinite(stamp) || stamp < activatedAt || stamp < now - 600_000 || stamp > now + 60_000) return null;
  let message = envelope.message;
  for (let i = 0; i < 2 && message?.ephemeralMessage; i++) message = message.ephemeralMessage.message;
  const text = message?.conversation ?? message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || text.length > 4000) return null;
  const match = text.trimStart().match(/^(?:columbus|קולומבוס)(?=$|[\s,:;.!?־–—-])[\s,:;.!?־–—-]*([\s\S]*)$/iu);
  if (!match || match[1].length > 3000) return null;
  const context = message?.extendedTextMessage?.contextInfo;
  const quotedID = (!context?.remoteJid || context.remoteJid === target) && typeof context?.stanzaId === 'string' ? context.stanzaId.slice(0,128) : null;
  return { id: key.id, sender: key.participant || (key.fromMe ? 'linked-owner' : ''), question: match[1].trim(), quotedID };
}
export function restrictSocket(sock, target) {
  requireGroup(target);
  const original = sock.ws.listeners('CB:message');
  if (!original.length) throw new Error('Pinned WhatsApp message boundary unavailable');
  sock.ws.removeAllListeners('CB:message');
  sock.ws.on('CB:message', function(node, ...rest) {
    if (!allowedFrame(node, target)) return;
    for (const listener of original) listener.call(this, node, ...rest);
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
