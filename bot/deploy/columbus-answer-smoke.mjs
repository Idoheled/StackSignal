// Exercise the installed answer parser against real local Ollama without posting.
import { answerQuestion } from '/opt/stacksignal/bot/columbus-runtime.mjs';

const languages = [];
for (const [language, question] of [
  ['en', 'Explain in one short sentence what a Kubernetes scheduler does.'],
  ['he', 'תסביר במשפט קצר אחד מה עושה המתזמן של קוברנטיס.'],
]) {
  const answer = await answerQuestion(question, null, { model: process.env.OLLAMA_MODEL || 'qwen3:4b' });
  if (!answer.startsWith('🤖 *Columbus · קולומבוס*\n\n') || !answer.split('\n\n').slice(1).join('\n\n').trim())
    throw new Error('Final answer smoke check failed');
  languages.push(language);
}
// Do not log questions, generated answers, or the model's separate thinking field.
console.log(JSON.stringify({ status: 'ready', languages, final_answer_only: true, group_messages_sent: 0 }));
