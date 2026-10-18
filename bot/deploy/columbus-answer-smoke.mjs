// Exercise the installed answer parser against real local Ollama without posting.
import {platformContext,releaseRequest,formatReleases} from '/opt/stacksignal/bot/operations.mjs';
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
const question='קולומבוס מה כל שבעת הreleaseים האחרונים שנכנסו לפלטפורמה?';
if(releaseRequest(question)!==7)throw Error('Release request parsing failed');
const catalog=await platformContext('latest_releases',7);
if(!catalog.releases.length||!formatReleases(catalog,question).includes(catalog.releases[0].title.replace(/[*_~`@]/g,'')))throw Error('Live catalog verification failed');
// Do not log questions, generated answers, or the model's separate thinking field.
console.log(JSON.stringify({ status: 'ready', languages, final_answer_only: true, catalog_verified: true, catalog_rows: catalog.releases.length, group_messages_sent: 0 }));
