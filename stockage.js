/* Vigie Patrimoine — stockage GitHub (dépôt privé) qui remplace la base de l'artifact.
   Données : donnees/portefeuille.json du dépôt privé, lu et écrit avec un jeton GitHub personnel
   (droits « Contents : read and write » et, pour le bouton « Rafraîchir les cours », « Actions : read and write », sur ce seul dépôt), gardé dans ce navigateur uniquement.
   Hors ligne : la dernière copie reçue reste affichée ; les modifications demandent une connexion. */
(() => {
  const CFG = "vigie-gh", CACHE = "vigie-cache", POLL = 60000;
  const DEF = { owner: "rulio12-xxx", repo: "vigie-patrimoine", branch: "main", path: "donnees/portefeuille.json" };
  const cfg = () => { try { return JSON.parse(localStorage.getItem(CFG) || "null"); } catch { return null; } };
  let data = null, sha = null, etag = null, recu = null, listeners = new Set(), timer = null;

  const b64dec = s => { const bin = atob(s.replace(/\n/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); };
  const b64enc = str => { const u = new TextEncoder().encode(str); let b = ""; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); };
  // JSON trié comme le robot (json.dumps sort_keys, indent=1) pour garder des différences git lisibles
  const tri = v => Array.isArray(v) ? v.map(tri) : (v && typeof v === "object") ? Object.keys(v).sort().reduce((o, k) => (o[k] = tri(v[k]), o), {}) : v;
  const texte = d => JSON.stringify(tri(d), null, 1) + "\n";
  const url = c => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path}?ref=${c.branch}`;
  const entetes = c => ({ Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const heure = t => t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?";
  const bandeau = (txt) => setTimeout(() => { const b = document.getElementById("banner"); if (!b) return; if (txt) { b.textContent = txt; b.hidden = false; } else b.hidden = true; }, 300);
  const etat = (txt) => { const e = document.getElementById("syncEtat"); if (e) e.textContent = txt; };

  function cacheSauver() { try { localStorage.setItem(CACHE, JSON.stringify({ data, sha, recu })); } catch { } }
  function cacheLire() { try { const c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && c.data) { data = c.data; sha = c.sha; recu = c.recu; return true; } } catch { } return false; }
  function prevenir() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

  async function tirer(force) {
    const c = cfg(); if (!c) throw new Error("non connecté");
    const h = entetes(c); if (etag && !force) h["If-None-Match"] = etag;
    const r = await fetch(url(c), { headers: h, cache: "no-store" });
    if (r.status === 304) { recu = Date.now(); cacheSauver(); return false; }
    if (r.status === 401 || r.status === 403) throw new Error(`jeton refusé (${r.status})`);
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    let t = j.content ? b64dec(j.content) : null;
    if (!t) { const r2 = await fetch(url(c), { headers: { ...entetes(c), Accept: "application/vnd.github.raw+json" }, cache: "no-store" }); t = await r2.text(); }
    data = JSON.parse(t); sha = j.sha; etag = r.headers.get("ETag"); recu = Date.now();
    cacheSauver(); prevenir(); return true;
  }

  async function synchro() {
    if (!navigator.onLine) { bandeau(`Hors ligne : données du ${heure(recu)} (consultation seulement).`); etat("hors ligne"); return; }
    try { await tirer(false); bandeau(""); etat(`synchronisé ${heure(recu)} · robot ${data?.etat?.releve || "?"}`); }
    catch (e) { bandeau(`Synchronisation impossible (${e.message}) : données du ${heure(recu)}.`); etat("erreur"); }
  }

  async function ecrire(mut, message) {
    if (!navigator.onLine) throw new Error("Hors ligne : modification impossible pour l'instant");
    const c = cfg();
    for (let essai = 0; essai < 4; essai++) {
      await tirer(true);
      const d = JSON.parse(JSON.stringify(data)); mut(d); d.maj = new Date().toISOString();
      const r = await fetch(url(c).split("?")[0], { method: "PUT", headers: { ...entetes(c), "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: b64enc(texte(d)), sha, branch: c.branch }) });
      if (r.status === 409 || r.status === 422) { await new Promise(s => setTimeout(s, 800)); continue; }
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const j = await r.json(); sha = j.content.sha; data = d; etag = null; recu = Date.now();
      cacheSauver(); prevenir(); return;
    }
    throw new Error("conflit répété avec le robot, réessaie dans une minute");
  }

  const slug = s => (s || "ligne").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ligne";
  const snapDoc = (id, v) => ({ id, exists: v != null, data: () => (v == null ? undefined : JSON.parse(JSON.stringify(v))) });
  const ecoute = f => { listeners.add(f); if (data) setTimeout(f, 0); return () => listeners.delete(f); };

  function collection(nom) {
    const table = () => nom === "lignes" ? (data?.lignes || {}) : (data?.journal || {});
    const cible = d => nom === "lignes" ? (d.lignes ||= {}) : (d.journal ||= {});
    return {
      onSnapshot(cb) { return ecoute(() => cb({ docs: Object.entries(table()).map(([id, v]) => snapDoc(id, v)) })); },
      doc(id) {
        id = id || ("l-" + Date.now().toString(36));
        return {
          id,
          onSnapshot(cb) { return ecoute(() => cb(snapDoc(id, table()[id]))); },
          set(v) { return ecrire(d => { cible(d)[id] = v; }, `Page : ${v?.nom || id} modifié`); },
          update(p) { return ecrire(d => { const t = cible(d); t[id] = { ...(t[id] || {}), ...p }; }, `Page : ${t2(id)} mis à jour`); },
          delete() { return ecrire(d => { delete cible(d)[id]; }, `Page : ${id} supprimé`); },
        };
      },
    };
    function t2(x) { return (table()[x] || {}).nom || x; }
  }
  const db = { collection };

  // écran de connexion (une fois par appareil)
  function connexion() {
    return new Promise(resolve => {
      const host = document.createElement("div");
      host.className = "login";
      host.innerHTML = `<form class="loginbox">
        <h2>Vigie Patrimoine</h2>
        <p>Les données sont dans ton dépôt GitHub privé. Colle un jeton personnel (« fine-grained ») avec l'accès <b>Contents : Read and write</b> sur <b>${DEF.owner}/${DEF.repo}</b> uniquement. Il reste dans ce navigateur.</p>
        <label>Jeton GitHub<input id="lg-token" type="password" autocomplete="off" required placeholder="github_pat_…"></label>
        <details><summary>Dépôt</summary>
          <label>Propriétaire<input id="lg-owner" value="${DEF.owner}"></label>
          <label>Dépôt<input id="lg-repo" value="${DEF.repo}"></label></details>
        <div class="err" id="lg-err" hidden></div>
        <button type="submit">Se connecter</button></form>`;
      document.body.appendChild(host);
      host.querySelector("form").addEventListener("submit", async e => {
        e.preventDefault();
        const c = { ...DEF, token: host.querySelector("#lg-token").value.trim(), owner: host.querySelector("#lg-owner").value.trim(), repo: host.querySelector("#lg-repo").value.trim() };
        localStorage.setItem(CFG, JSON.stringify(c));
        try { await tirer(true); host.remove(); resolve(); }
        catch (x) { localStorage.removeItem(CFG); const er = host.querySelector("#lg-err"); er.textContent = "Connexion refusée : " + x.message; er.hidden = false; }
      });
    });
  }

  // Relevé manuel : lance le robot (workflow robot.yml) puis resynchronise quand il a fini.
  // Le jeton doit aussi avoir « Actions : read and write » sur le dépôt.
  async function relever() {
    const c = cfg(); if (!c) return;
    const bs = ["btnRelever", "btnReleverHaut"].map(id => document.getElementById(id)).filter(Boolean);
    const txt = { btnRelever: "Rafraîchir les cours", btnReleverHaut: "↻ Rafraîchir les cours" };
    const b = bs.length ? { set disabled(v) { bs.forEach(x => x.disabled = v); }, set textContent(t) { bs.forEach(x => x.textContent = t === null ? txt[x.id] : (x.id === "btnReleverHaut" ? "↻ " : "") + t); } } : null;
    let fin = (t) => { if (b) { b.disabled = false; b.textContent = null; } etat(t); };
    if (!navigator.onLine) { etat("hors ligne"); return; }
    if (b) { b.disabled = true; b.textContent = "Relevé 0 %"; }
    // progression : étapes du robot terminées (API GitHub) et, entre deux relevés, temps écoulé / durée du dernier relevé (plafonné à 95 %)
    const DUREE = "vigie-duree-releve", t0 = Date.now();
    let duree = 150000, pEtapes = 0, pct = 0;
    try { duree = Math.max(60000, +localStorage.getItem(DUREE) || 150000); } catch (_) {}
    const hb = document.getElementById("btnReleverHaut");
    let barre = document.getElementById("progReleve");
    if (hb && !barre) { barre = document.createElement("span"); barre.id = "progReleve"; barre.className = "progReleve"; barre.innerHTML = "<i></i>"; hb.after(barre); }
    if (barre) barre.hidden = false;
    const montrer = (v) => { pct = Math.max(pct, Math.min(100, Math.round(v))); if (b) b.textContent = `Relevé ${pct} %`; if (barre) barre.firstChild.style.width = pct + "%"; };
    const tic = setInterval(() => montrer(Math.max(pEtapes, Math.min(95, (Date.now() - t0) / duree * 100))), 1000);
    const fin0 = fin;
    fin = (t) => { clearInterval(tic); if (barre) setTimeout(() => { barre.hidden = true; barre.firstChild.style.width = "0"; }, 1500); fin0(t); };
    const api = `https://api.github.com/repos/${c.owner}/${c.repo}/actions/workflows/robot.yml`;
    const depart = Date.now() - 5000;
    try {
      const r = await fetch(`${api}/dispatches`, { method: "POST", headers: { ...entetes(c), "Content-Type": "application/json" }, body: JSON.stringify({ ref: c.branch }) });
      if (r.status === 403 || r.status === 404) { fin("jeton sans droit « Actions : read and write »"); bandeau("Rafraîchir les cours : ajoute le droit « Actions : read and write » à ton jeton GitHub (même jeton, rien à recoller)."); return; }
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      // cours en temps réel pendant le relevé (11/11/2026) : le robot publie d'abord donnees/marche/cours.json ;
      // l'appli l'interroge toutes les 5 s et reporte aussitôt les nouveaux cours sur les lignes affichées (seuils et signaux suivent à la fin).
      const urlCours = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/donnees/marche/cours.json?ref=${c.branch}`;
      let etagC = null, nbMaj = 0, vuCle = "";
      const releve0 = data?.etat?.releve || "";
      const coursDirect = async () => {
        try {
          const h = { ...entetes(c), Accept: "application/vnd.github.raw+json" }; if (etagC) h["If-None-Match"] = etagC;
          const r = await fetch(urlCours, { headers: h, cache: "no-store" });
          if (r.status !== 200) return;
          etagC = r.headers.get("ETag");
          const cj = await r.json(); const L = cj.lignes || {}, d = data?.lignes || {};
          const cle = `${cj.releve}#${cj.partiel || 0}`;
          if (!cj.releve || cj.releve < releve0 || cle === vuCle) return;
          let k = 0;
          for (const [id, q] of Object.entries(L)) {
            const l = d[id]; if (!l || q.cours == null || l.code === "FCPE" || l.vl || l.env === "PEE" || l.suivi?.facteur || (q.devise && q.devise !== "EUR")) continue;
            if (l.cours !== q.cours || l.coursHeure !== q.heure) { l.cours = q.cours; l.coursDate = q.date; l.coursHeure = q.heure; l.tempsReel = false; k++; }
          }
          vuCle = cle;
          if (k) { nbMaj += k; prevenir(); etat(`cours en direct : ${nbMaj} lignes mises à jour${cj.partiel ? " (relevé en cours)" : ""} · seuils en cours de calcul`); }
        } catch (_) {}
      };
      for (let i = 0; i < 80; i++) {           // jusqu'à 6 min 40, toutes les 5 s
        await new Promise(ok => setTimeout(ok, 5000));
        await coursDirect();
        if (i % 2) continue;
        const q = await fetch(`${api}/runs?event=workflow_dispatch&per_page=1`, { headers: entetes(c), cache: "no-store" });
        const run = q.ok ? (await q.json()).workflow_runs?.[0] : null;
        if (run && Date.parse(run.created_at) >= depart) {
          if (!nbMaj) etat(`relevé : ${run.status === "completed" ? "terminé" : "en cours"} (${i * 5 + 5} s)`);
          try {
            const j = await fetch(run.jobs_url, { headers: entetes(c), cache: "no-store" });
            const st = j.ok ? ((await j.json()).jobs || []).flatMap(x => x.steps || []) : [];
            if (st.length) pEtapes = Math.min(95, st.filter(x => x.status === "completed").length / st.length * 100);
          } catch (_) {}
          if (run.status === "completed") {
            if (run.conclusion !== "success") { fin(`relevé en échec (${run.conclusion})`); return; }
            try { localStorage.setItem(DUREE, String(Date.now() - t0)); } catch (_) {}
            montrer(100); await tirer(true); fin(`cours rafraîchis ${heure(recu)} · robot ${data?.etat?.releve || "?"}`); return;
          }
        }
      }
      fin("relevé trop long : réessaie la synchronisation dans quelques minutes");
    } catch (e) { fin(`relevé impossible (${e.message})`); }
  }
  window.vigieRelever = () => relever();
  window.vigieDeconnexion = () => { if (confirm("Oublier le jeton et les données sur cet appareil ?")) { localStorage.removeItem(CFG); localStorage.removeItem(CACHE); location.reload(); } };
  window.vigieSynchro = () => synchro();

  window.claude = {
    use: async (k) => {
      if (k !== "db") return null;
      cacheLire();
      if (!cfg()) { await connexion(); synchro(); } else synchro();
      clearInterval(timer);
      timer = setInterval(() => { if (document.visibilityState === "visible") synchro(); }, POLL);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchro(); });
      addEventListener("online", synchro); addEventListener("offline", synchro);
      return db;
    }
  };
  // mise à jour automatique de l'appli (09/11/2026) : à chaque retour sur la page et toutes les 15 min, le service worker vérifie
  // s'il existe une nouvelle version ; quand elle prend la main, la page se recharge d'elle-même (une seule fois)
  if ("serviceWorker" in navigator) {
    const avait = !!navigator.serviceWorker.controller;
    let recharge = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (avait && !recharge) { recharge = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js").then(reg => {
      const verif = () => reg.update().catch(() => { });
      setInterval(() => { if (document.visibilityState === "visible") verif(); }, 15 * 60000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verif(); });
    }).catch(() => { });
  }
})();
