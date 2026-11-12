// push-candidates.js — pousse un fichier de candidates dans la file du dépôt (utilisable par une vague nocturne AVEC réseau, ou en interactif)
// Usage: node push-candidates.js <fichier.json> <TOKEN> [nom-dans-la-file]
const fs = require('fs'), path = require('path');
const [,, file, TOK, name] = process.argv;
if (!file || !TOK || !TOK.startsWith('github_pat_')) { console.error('Usage: node push-candidates.js <fichier.json> <TOKEN> [nom]'); process.exit(1); }
const API = 'https://api.github.com', REPO = 'Alexlft73/Pharmarevues';
const H = { 'Authorization': 'Bearer ' + TOK, 'Accept': 'application/vnd.github+json', 'User-Agent': 'vibe-push' };
const remote = 'candidates-queue/' + (name || path.basename(file));
JSON.parse(fs.readFileSync(file, 'utf8')); // doit être du JSON valide
async function api(m, u, b) {
  const r = await fetch(API + u, { method: m, headers: { ...H, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) throw new Error(m + ' ' + u + ' → ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}
(async () => {
  const content = fs.readFileSync(file).toString('base64');
  const ref = await api('GET', '/repos/' + REPO + '/git/ref/heads/main');
  const commit = await api('GET', '/repos/' + REPO + '/git/commits/' + ref.object.sha);
  const blob = await api('POST', '/repos/' + REPO + '/git/blobs', { content, encoding: 'base64' });
  const tree = await api('POST', '/repos/' + REPO + '/git/trees', { base_tree: commit.tree.sha, tree: [{ path: remote, mode: '100644', type: 'blob', sha: blob.sha }] });
  const nc = await api('POST', '/repos/' + REPO + '/git/commits', { message: 'Veille: nouvelles candidates (' + remote + ')', tree: tree.sha, parents: [ref.object.sha] });
  await api('PATCH', '/repos/' + REPO + '/git/refs/heads/main', { sha: nc.sha });
  console.log('✅ Candidates poussées: ' + remote + ' (commit ' + nc.sha.slice(0, 9) + ') — l\'Action d\'injection se déclenche automatiquement.');
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
