#!/usr/bin/env node
/**
 * PharmaVeille — batterie de contrôle qualité du site (7 pages).
 * Lancée par .github/workflows/site-check.yml (après chaque injection + horaire).
 * Lit les fichiers locaux du dépôt (checkout), fait tourner les batteries locales,
 * puis compare le déploiement GitHub Pages au local (retries pendant le build).
 * Annexe le résultat à SITE_CHECKS.md. Exit 1 si échec (badge rouge Actions).
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const vm = require('vm');

const PAGES_URL = 'https://alexlft73.github.io/Pharmarevues/';
// Invariants par page : nombre de blocs <script>, tableaux const attendus
const PAGES = {
  'index.html':            { scripts: 2, arrays: ['REVUES', 'RECO', 'ALGOS', 'PEDI', 'MONTHS'] },
  'guide-filtres.html':    { scripts: 1, arrays: ['REVUES'] },
  'depliant-filtres.html': { scripts: 1, arrays: [] },
  'fiches-medicaments.html': { scripts: 2, arrays: ['FICHES'] },
  'classes-medicaments.html': { scripts: 2, arrays: ['CLASSES'] },
  'theses.html':          { scripts: 2, arrays: ['THESES'] },
  'pk-simulateur.html':   { scripts: 3, arrays: [] },
  'allegations-sante.html': { scripts: 2, arrays: ['ALLEG'] },
  'allegations-sante.html': { scripts: 2, arrays: ['ALLEG'] },
};
const MIN_LEN = { ALLEG: 30, ALLEG: 30, REVUES: 1000, RECO: 100, PEDI: 10, ALGOS: 5, THESES: 10, CLASSES: 10, FICHES: 10, MONTHS: 7 };
const ALL_ARRAYS = ['REVUES', 'RECO', 'PEDI', 'ALGOS', 'MONTHS', 'THESES', 'CLASSES', 'FICHES', 'ALLEG'];

const results = []; // {page, check, ok, detail}
function rec(page, check, ok, detail) { results.push({ page, check, ok, detail: detail || '' }); console.log(`${ok ? '  ✅' : '  ❌'} ${page} · ${check}${detail ? ' — ' + detail : ''}`); }

function extractBlocks(html, page, expected) {
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  rec(page, `équilibre <script> (${open} ouverts / ${close} fermés / ${expected} attendus)`, open === close && open === expected, `${open}/${close}/${expected}`);
  // Balise et code sur la même ligne = fragilité d'injection historique
  const badInline = html.split('\n').filter(l => /<script[^>]*>./.test(l) || /.<\/script>/.test(l));
  rec(page, 'aucune balise script collée à du code sur une même ligne', badInline.length === 0, badInline.length ? `${badInline.length} ligne(s)` : '');
  const blocks = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks;
}

function evalBlock(block) {
  // Sandbox à « trou noir » : toute API DOM inconnue est absorbée sans planter.
  const hole = new Proxy(function () { return hole; }, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => '' : (p === 'length' ? 0 : hole)),
    set: () => true,
    apply: () => hole,
    construct: () => hole,
  });
  const base = { document: hole, window: hole, navigator: hole, location: hole, Date, Math, JSON, Array, Object, String, Number };
  const sandbox = new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : (typeof p === 'string' && (p === 'localStorage' || p === 'matchMedia')) ? hole : (p === Symbol.unscopables ? undefined : hole)),
    set: (t, p, v) => { t[p] = v; return true; },
    has: () => true,
  });
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const cap = '\n;globalThis.__CAP = {' + ALL_ARRAYS.map(n => `${n}:(typeof ${n}!=="undefined"&&${n}?${n}:null)`).join(',') + '};';
  vm.runInContext(block + cap, vm.createContext(sandbox), { timeout: 30000 });
  return sandbox.__CAP || {};
}

function localBattery(page, file) {
  const html = fs.readFileSync(file, 'utf8');
  const spec = PAGES[page];
  const blocks = extractBlocks(html, page, spec.scripts);
  rec(page, `blocs extraits (${blocks.length}/${spec.scripts})`, blocks.length === spec.scripts);
  for (let i = 0; i < blocks.length; i++) {
    try { new vm.Script(blocks[i]); rec(page, `bloc #${i + 1} compile (syntaxe JS valide)`, true); }
    catch (e) { rec(page, `bloc #${i + 1} compile (syntaxe JS valide)`, false, e.message); }
  }
  let cap = {};
  const withArrays = blocks.filter(b => new RegExp('const (' + ALL_ARRAYS.join('|') + ') =').test(b)).join('\n');
  try { cap = evalBlock(withArrays || blocks[0] || ''); }
  catch (e) { rec(page, 'évaluation sandbox (DOM simulé)', false, e.message); }
  for (const arr of spec.arrays) {
    const v = cap[arr];
    if (arr === 'MONTHS') {
      // MONTHS est un objet {"01":"janv.",...}, pas un tableau
      rec(page, 'const MONTHS : objet ≥ 7 mois', !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length >= 7, v ? Object.keys(v).length + ' clés' : 'absent');
      continue;
    }
    if (!Array.isArray(v) || !v.length) { rec(page, `const ${arr} évalué`, false, 'absent ou vide'); continue; }
    const min = MIN_LEN[arr] || 1;
    rec(page, `const ${arr} : ${v.length} entrées (seuil ${min})`, v.length >= min, `${v.length}`);
    const bad = v.filter(e => !e || typeof e !== 'object').length;
    rec(page, `const ${arr} : aucune entrée vide`, bad === 0, `${bad} entrée(s) invalide(s)`);
  }
  return cap;
}

async function fetchDeployed(page) {
  const url = PAGES_URL + page + '?ts=' + Date.now();
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache, max-age=0', 'User-Agent': 'pv-site-check' } });
  if (!res.ok) return { ok: false, err: 'HTTP ' + res.status };
  const body = await res.text();
  return { ok: true, md5: crypto.createHash('md5').update(body).digest('hex'), bytes: body.length };
}

async function deployedCompare(page, file, retries, waitMs) {
  const local = fs.readFileSync(file, 'utf8');
  const localMd5 = crypto.createHash('md5').update(local).digest('hex');
  for (let i = 1; i <= retries; i++) {
    try {
      const d = await fetchDeployed(page);
      if (d.ok && d.md5 === localMd5) { rec(page, `Pages déployé == local (md5, essai ${i})`, true, localMd5.slice(0, 8)); return true; }
      if (!d.ok) console.log(`  ⏳ ${page} : déployé indisponible (${d.err}), essai ${i}/${retries}`);
      else console.log(`  ⏳ ${page} : md5 déployé ${d.md5.slice(0, 8)} ≠ local ${localMd5.slice(0, 8)} (build Pages en cours ?), essai ${i}/${retries}`);
    } catch (e) { console.log(`  ⏳ ${page} : ${e.message}, essai ${i}/${retries}`); }
    if (i < retries) await new Promise(r => setTimeout(r, waitMs));
  }
  rec(page, 'Pages déployé == local (md5)', false, 'divergé après ' + retries + ' essais');
  return false;
}

async function main() {
  const RETRIES = parseInt(process.env.DEPLOY_RETRIES || '15', 10);
  const WAIT = parseInt(process.env.DEPLOY_WAIT_MS || '60000', 10);
  const SKIP_DEPLOYED = process.env.SKIP_DEPLOYED === '1';
  console.log('— Batterie locale —');
  const caps = {};
  for (const page of Object.keys(PAGES)) {
    if (!fs.existsSync(page)) { rec(page, 'fichier présent', false, 'introuvable'); continue; }
    caps[page] = localBattery(page, page) || {};
  }
  // Compteur croisé : dépliant statique vs longueur réelle de REVUES (index)
  const revues = (caps['index.html'] || {}).REVUES || [];
  const dep = fs.existsSync('depliant-filtres.html') ? fs.readFileSync('depliant-filtres.html', 'utf8') : '';
  const m = dep.match(/([0-9]+) revues sourcées/);
  if (revues.length && m) {
    const n = parseInt(m[1], 10);
    rec('depliant-filtres.html', `compteur global « ${n} revues sourcées » == REVUES.length (${revues.length})`, n === revues.length, `dépliant ${n} vs index ${revues.length}`);
  } else {
    rec('depliant-filtres.html', 'compteur global présent et comparable', false, m ? 'REVUES non évalué' : 'motif compteur introuvable');
  }
  // Ancres d'injection : le littéral de fin d'array doit rester en place pour la prochaine vague
  for (const [page, anchor, label] of
    [['index.html', /]\s*;\s*\n\s*const MONTHS/, 'ancre injection fin REVUES → const MONTHS'],
     ['index.html', /]\s*;\s*\n\s*var AICO/, 'ancre injection fin ALGOS → var AICO']]) {
    if (!fs.existsSync(page)) continue;
    rec(page, label, anchor.test(fs.readFileSync(page, 'utf8')));
  }
  // Déployé vs local
  let deployedOk = 0;
  if (!SKIP_DEPLOYED) {
    console.log('— Déploiement GitHub Pages vs local —');
    for (const page of Object.keys(PAGES)) {
      if (fs.existsSync(page) && (await deployedCompare(page, page, RETRIES, WAIT))) deployedOk++;
    }
  }
  // Résumé + SITE_CHECKS.md
  const fails = results.filter(r => !r.ok);
  const allPages = Object.keys(PAGES);
  const pagesOk = allPages.filter(p => results.some(r => r.page === p && r.ok) && !results.some(r => r.page === p && !r.ok)).length;
  const counts = ['REVUES', 'RECO', 'PEDI', 'ALGOS', 'THESES', 'CLASSES', 'FICHES'].map(a => {
    for (const pg of allPages) { const v = (caps[pg] || {})[a]; if (Array.isArray(v)) return a + ':' + v.length; }
    return a + ':_';
  }).join(' ');
  const now = new Date();
  const line = `| ${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)} UTC | ${process.env.HEAD_SHA || 'N/A'} | ${pagesOk}/${allPages.length} pages | ${counts} | déployé ${SKIP_DEPLOYED ? 'non testé' : deployedOk + '/' + allPages.length} | ${fails.length === 0 ? '✅ PASS' : '❌ FAIL (' + fails.length + ')'} |`;
  console.log('\nBILAN : ' + (fails.length === 0 ? '✅ SITE 100 % OK' : `❌ ${fails.length} échec(s)`));
  fails.forEach(f => console.log(`  ✗ ${f.page} · ${f.check} — ${f.detail}`));
  fs.appendFileSync('SITE_CHECKS.md', line + '\n');
  console.log('Ligne ajoutée à SITE_CHECKS.md : ' + line);
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
