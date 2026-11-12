// inject.js — moteur d'injection PharmaVeille (exécuté par GitHub Actions)
// Usage: node scripts/inject.js
// Lit candidates-queue/*.json (schéma vague : {id,ty,dom,n,dt,des,tag,res,src[,coi][,fin][,off]} ou entrée canvas prête),
// injecte dans index.html (REVUES + RECO + pastilles NEW), recalcule guide-filtres.html et depliant-filtres.html.
// ZÉRO improvisation : si une validation échoue → exit 1, AUCUN commit (le workflow ne pousse que si exit 0).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const IDX = path.join(ROOT, 'index.html');
const q = (m, s) => s.match(m) && s.match(m)[1];
function fail(msg) { console.error('❌ VALIDATION: ' + msg); process.exit(1); }

let html = fs.readFileSync(IDX, 'utf8');

// ---------- 1. File de candidates ----------
const queueDir = path.join(ROOT, 'candidates-queue');
const files = fs.existsSync(queueDir) ? fs.readdirSync(queueDir).filter(f => f.endsWith('.json')).sort() : [];
if (!files.length) { console.log('File vide — rien à faire.'); process.exit(0); }
const TY = { 'Médicament': 'Médicament', 'Complément': 'Complément alimentaire', 'Officine': 'Officine', 'Alimentation': 'Alimentation', 'Vaccin': 'Vaccin', 'Alerte': 'Alerte', 'Économie': 'Économie' };
function toCanvas(c) {
  if (c.titre && c.type) return c; // déjà au schéma canvas
  let res = c.res || '', off = c.off || '';
  const m = res.match(/^(.*?)(?:\s*(?:En officine\s*:\s*|Le message officinal\s*:\s*|officine\s*:\s*|À dire au patient\s*:\s*))(.*)$/i);
  if (!off && m && m[2] && m[2].length > 10) { res = m[1].trim(); off = m[2].trim().replace(/^./, x => x.toUpperCase()); }
  res = res.replace(/\s*Distinct de [^;.]*en base[^;.]*[;.]/gi, '').trim();
  return { dom: c.dom, type: TY[c.ty] || c.ty, n: c.n, dt: c.dt, titre: c.des, subst: c.tag, res, src: c.src, coi: c.coi || 'À vérifier', fin: c.fin || 'Financement non lisible dans les sources consultées.', ...(off ? { off } : {}) };
}
let newRevues = [], newRecos = [];
const skipped = [];
for (const f of files) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(queueDir, f), 'utf8')); } catch (e) { fail('JSON illisible: ' + f + ' (' + e.message + ')'); }
  (j.revues || []).forEach(c => { try { newRevues.push(toCanvas(c)); } catch (e) { fail('Conversion impossible: ' + f); } });
  (j.recos || []).forEach(c => newRecos.push(c));
}

// ---------- 2. État actuel + dédoublonnage ----------
const R = eval(q(/const REVUES = (\[[\s\S]*?\n]);/, html));
const RC = eval(q(/const RECO = (\[[\s\S]*?\n]);/, html));
const rTitles = new Set(R.map(r => r.titre)), cTitles = new Set(RC.map(r => r.titre));
const dup = newRevues.filter(c => rTitles.has(c.titre)); newRevues = newRevues.filter(c => !rTitles.has(c.titre));
const dupR = newRecos.filter(c => cTitles.has(c.titre)); newRecos = newRecos.filter(c => !cTitles.has(c.titre));
dup.concat(dupR).forEach(c => skipped.push('DOUBLON: ' + (c.titre || c.des || '?').slice(0, 70)));
// champs obligatoires
newRevues.forEach(c => ['dom','type','n','dt','titre','subst','res','src'].forEach(k => { if (c[k] === undefined) fail('Champ manquant "' + k + '" dans: ' + c.titre); }));
newRecos.forEach(c => ['spe','org','dt','titre','res','src'].forEach(k => { if (c[k] === undefined) fail('Champ manquant "' + k + '" (RECO): ' + c.titre); }));
if (!newRevues.length && !newRecos.length) {
  console.log('Aucune nouvelle entrée (tout en doublon). File à vider manuellement.');
  skipped.forEach(s => console.log('  ' + s)); process.exit(0);
}

// ---------- 3. Injection REVUES ----------
const a1 = '\n];\n\nconst MONTHS';
if (!html.includes(a1)) fail('ancre REVUES introuvable');
const lines = newRevues.map(c => JSON.stringify(c)).join(',\n');
html = html.replace(a1, ',\n' + lines + a1);
// corrige une éventuelle double virgule héritée de la ligne précédant l'ancre
html = html.replace(/\},,(?=\n)/g, '},');

// ---------- 4. Injection RECO ----------
const i0 = html.indexOf('const RECO = [');
const i1 = html.indexOf('\n];', i0);
if (i0 < 0 || i1 < 0) fail('ancre RECO introuvable');
html = html.slice(0, i1) + ',\n' + newRecos.map(c => JSON.stringify(c)).join(',\n') + html.slice(i1);

// ---------- 5. Pastilles NEW ----------
function addFrais(setName, arr) {
  if (!html.includes('const ' + setName + ' = new Set([')) {
    const niv = 'const NIV = {1:"N1 · Méta-analyse", 2:"N2 · Phase 3", 3:"N3 · Phase 2 / petit essai", 4:"N4 · Vie réelle", 5:"N5 · Revue / alerte"};';
    html = html.replace(niv, niv + '\nconst ' + setName + ' = new Set(' + JSON.stringify([]) + ');');
  }
  const re = new RegExp('const ' + setName + ' = new Set\\((\\[[\\s\\S]*?\\])\\);');
  const cur = eval(html.match(re)[1]);
  arr.forEach(t => cur.push(t));
  html = html.replace(re, 'const ' + setName + ' = new Set(' + JSON.stringify(cur) + ');');
}
addFrais('FRAIS', newRevues.map(c => c.titre));
addFrais('FRAISRECO', newRecos.map(c => c.titre));

// ---------- 6. Validation structurelle (protocole post-incident) ----------
fs.writeFileSync(IDX, html);
const open = (html.match(/<script/g) || []).length, close = (html.match(/<\/script>/g) || []).length;
if (open !== close || open !== 2) fail('scripts déséquilibrés: ' + open + '/' + close);
const bad = html.match(/<script[^>]*>\..{0,40}/); if (bad) fail('balise script+contenu: ' + bad[0]);
const R2 = eval(q(/const REVUES = (\[[\s\S]*?\n]);/, html));
const RC2 = eval(q(/const RECO = (\[[\s\S]*?\n]);/, html));
let hole = 0; R2.forEach(() => hole++); if (R2.length !== hole) fail('case vide dans REVUES (double virgule)');
let n = 0; R2.forEach(r => { if (!r.titre || !r.src) n++; }); if (n) fail(n + ' entrées REVUES incomplètes');
if (R2.length !== R.length + newRevues.length) fail('comptage REVUES incohérent');
if (RC2.length !== RC.length + newRecos.length) fail('comptage RECO incohérent');
try { new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]); } catch (e) { fail('JS principal: ' + e.message); }
try { new Function(html.match(/<script id="pv-theme-init">([\s\S]*?)<\/script>/)[1]); } catch (e) { fail('JS thème: ' + e.message); }
console.log('✅ index.html : REVUES ' + R.length + '→' + R2.length + ' (+' + newRevues.length + ') · RECO ' + RC.length + '→' + RC2.length + ' (+' + newRecos.length + ')');

// ---------- 7. guide-filtres.html (compteurs 100% dynamiques) ----------
const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'filtre-template.html'), 'utf8');
if (!tpl.includes('__DATA__')) fail('template filtre invalide');
fs.writeFileSync(path.join(ROOT, 'guide-filtres.html'), tpl.replace('__DATA__', JSON.stringify(R2)));
console.log('✅ guide-filtres.html régénéré (' + R2.length + ')');

// ---------- 8. depliant-filtres.html (compteurs codés en dur) ----------
const dep = fs.readFileSync(path.join(ROOT, 'depliant-filtres.html'), 'utf8');
const yr = {}; R2.forEach(r => yr[r.dt.slice(0, 4)] = (yr[r.dt.slice(0, 4)] || 0) + 1);
const nComp = R2.filter(r => r.type === 'Complément alimentaire').length;
const nDom = new Set(R2.map(r => r.dom)).size;
let d = dep
  .replace(/(\d+) revues sourcées/, R2.length + ' revues sourcées')
  .replace(/« Toutes disciplines » \((\d+)\)/, '« Toutes disciplines » (' + R2.length + ')')
  .replace(/(\d+) revues sur 3 années/, R2.length + ' revues sur 3 années')
  .replace(/les (\d+) revues compléments/, 'les ' + nComp + ' revues compléments')
  .replace(/2026<\/b> \((\d+) revues\) · <b>2025<\/b> \((\d+)\) · <b>2024<\/b> \((\d+)\)/, '2026</b> (' + (yr['2026'] || 0) + ' revues) · <b>2025</b> (' + (yr['2025'] || 0) + ') · <b>2024</b> (' + (yr['2024'] || 0) + ')')
  .replace(/(\d+) disciplines/g, nDom + ' disciplines')
  .replace(/v(\d+)\.(\d+)/, (m, a, b) => 'v' + a + '.' + (parseInt(b) + 1));
fs.writeFileSync(path.join(ROOT, 'depliant-filtres.html'), d);
console.log('✅ depliant recalé : ' + R2.length + ' revues · ' + nComp + ' compléments · ' + nDom + ' disciplines');

// ---------- 9. Résumé pour le message de commit ----------
const summary = ['Injection auto: +' + newRevues.length + ' REVUES, +' + newRecos.length + ' RECO (base ' + R2.length + '/' + RC2.length + ')'];
if (skipped.length) summary.push('écartés: ' + skipped.length);
fs.writeFileSync(path.join(ROOT, 'INJECTION_LOG.md'), '# Injection automatique\n\n- REVUES: +' + newRevues.length + ' → ' + R2.length + '\n- RECO: +' + newRecos.length + ' → ' + RC2.length + '\n- NEW: ' + (newRevues.length + newRecos.length) + '\n\n## Écartés\n' + (skipped.map(s => '- ' + s).join('\n') || '- aucun') + '\n');
skipped.forEach(s => console.log('⚠️ ' + s));
console.log('OK');
