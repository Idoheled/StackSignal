export async function processNext(store, { generate, deliver, now = Date.now } = {}) {
  const row = store.claim(now());
  if (!row) return false;
  let message;
  try { message = row.message || await generate(JSON.parse(row.payload)); }
  catch { store.retryGeneration(row.id, now()); return true; }
  if (!store.prepareSend(row.id, message, now())) return true;
  try {
    const id = await deliver(message);
    if (!store.confirm(row.id, id, now())) store.uncertain(row.id, now());
  } catch { store.uncertain(row.id, now()); }
  return true;
}
