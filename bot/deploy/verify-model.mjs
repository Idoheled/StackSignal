// Exercises the real local model without sending a WhatsApp message.
import { generateMessage } from "../message.mjs";
const evaluated = new Date().toISOString(), id = "00000000-0000-0000-0000-000000000000";
const started = Date.now();
const model = process.env.OLLAMA_MODEL || "qwen3:4b";
const message = await generateMessage({ kind: "article_approved", title: "Reliable webhook delivery",
  summary: "A reviewed guide explains persistent queues, bounded retries and idempotency keys for webhook delivery.",
  why: "Engineers can avoid duplicate notifications and recover pending work after process restarts.",
  discovered_at: evaluated, evaluated_at: evaluated, ui_url: "https://stacksignal.stacksignal-idoheled.workers.dev/?article=" + id,
}, { model });
if (!message.includes(evaluated) || !message.includes("Why you should check this out") || !message.includes("?article=" + id))
  throw new Error("Local generated alert failed validation");
console.log(JSON.stringify({ ollama: true, model, duration_ms: Date.now() - started }));
