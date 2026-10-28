const SIDES = [
  { id: "A", name: "Bomb A" },
  { id: "B", name: "Bomb B" },
  { id: "mid", name: "Meio" },
];
const TEAMS = [
  { id: "CT", name: "CT" },
  { id: "TR", name: "TR" },
];
const KEY = "cs-utils-data-v1";
const $ = (id) => document.getElementById(id);

let data = { maps: [], tags: [], items: [] };
let state = { map: null, side: "all", team: "all", tags: new Set(), q: "", editing: null };

const save = () => localStorage.setItem(KEY, JSON.stringify(data));
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid();

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.forEach((k) => e.append(k));
  return e;
}
const chip = (text, on, fn) => el("button", { className: "chip" + (on ? " on" : ""), textContent: text, onclick: fn, type: "button" });

function parseYT(url) {
  const m = String(url).match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function parseIG(url) {
  const m = String(url).match(/instagram\.com\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]+)/);
  return m ? { type: m[1] === "reels" ? "reel" : m[1], code: m[2] } : null;
}
const isValidVideo = (url) => !!(parseYT(url) || parseIG(url));

function normalize(d) {
  if (!d || !Array.isArray(d.maps) || !Array.isArray(d.items)) throw new Error("JSON inválido");
  return {
    maps: d.maps.map((m) => ({ id: String(m.id), name: String(m.name) })),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    items: d.items.map((i) => ({
      id: String(i.id || uid()),
      title: String(i.title || ""),
      map: String(i.map),
      team: ["CT", "TR"].includes(i.team) ? i.team : "TR",
      side: ["A", "B", "mid"].includes(i.side) ? i.side : "mid",
      url: String(i.url || ""),
      start: Number(i.start) || 0,
      end: i.end ? Number(i.end) : null,
      tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
      notes: String(i.notes || ""),
    })),
  };
}

async function load() {
  const admin = localStorage.getItem(AUTH) === KEY_HASH;
  const draft = admin ? localStorage.getItem(KEY) : null;
  try {
    data = normalize(draft ? JSON.parse(draft) : await (await fetch("data.json", { cache: "no-store" })).json());
  } catch (e) {
    console.warn(e);
  }
  state.map = data.maps[0]?.id ?? null;
  render();
}

function render() {
  if (!data.maps.some((m) => m.id === state.map)) state.map = data.maps[0]?.id ?? null;

  const maps = $("maps");
  maps.replaceChildren(...data.maps.map((m) => chip(m.name, m.id === state.map, () => { state.map = m.id; render(); })));

  $("teams").replaceChildren(
    ...[{ id: "all", name: "Todos" }, ...TEAMS].map((s) => chip(s.name, state.team === s.id, () => { state.team = s.id; render(); }))
  );
  $("sides").replaceChildren(
    ...[{ id: "all", name: "Todos" }, ...SIDES].map((s) => chip(s.name, state.side === s.id, () => { state.side = s.id; render(); }))
  );

  state.tags = new Set([...state.tags].filter((t) => data.tags.includes(t)));
  $("tagFilter").replaceChildren(
    ...data.tags.map((t) => chip("#" + t, state.tags.has(t), () => {
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      render();
    }))
  );

  const q = state.q.toLowerCase();
  const items = data.items.filter((i) =>
    i.map === state.map &&
    (state.team === "all" || i.team === state.team) &&
    (state.side === "all" || i.side === state.side) &&
    [...state.tags].every((t) => i.tags.includes(t)) &&
    (!q || (i.title + " " + i.notes).toLowerCase().includes(q))
  );

  $("totalCount").textContent = data.items.length;
  $("mapCount").textContent = data.maps.length;
  $("listTitle").textContent = data.maps.find((m) => m.id === state.map)?.name ?? "Utilitárias";
  $("listSubtitle").textContent = `${items.length} ${items.length === 1 ? "resultado" : "resultados"}`;

  const grid = $("grid");
  if (!items.length) {
    grid.replaceChildren(el("div", { className: "empty", textContent: data.maps.length ? "Nenhuma utilitária aqui." : "Adicione um mapa em ⚙ Mapas/Tags." }));
    return;
  }
  grid.replaceChildren(...items.map(card));
}

/* Preview mudo em loop controlado por JS: o iframe fica oculto no reinício para esconder os botões do YouTube */
const REVEAL_MS = 2500;
function startPreview(box) {
  const { id, start, end } = box.dataset;
  const startS = +start, endS = +end;
  const p = new URLSearchParams({
    autoplay: 1, mute: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
    disablekb: 1, enablejsapi: 1, start: startS,
  });
  const frame = el("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${id}?${p}`,
    allow: "autoplay; encrypted-media", tabIndex: -1,
  });
  const send = (func, args = []) => frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  let restarting = false, revealTimer = null;
  // O preview só aparece depois de REVEAL_MS de reprodução contínua; qualquer buffer/seek/pausa o esconde de novo
  const hide = () => { clearTimeout(revealTimer); revealTimer = null; frame.classList.remove("ready"); };
  const scheduleReveal = () => {
    if (revealTimer || frame.classList.contains("ready")) return;
    revealTimer = setTimeout(() => { revealTimer = null; restarting = false; frame.classList.add("ready"); }, REVEAL_MS);
  };
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow) return;
    if (!frame.isConnected) return box._cleanup?.();
    let m; try { m = JSON.parse(e.data); } catch { return; }
    const info = m.info;
    if (m.event !== "infoDelivery" || !info) return;
    if (info.playerState !== undefined) {
      if (info.playerState === 1) scheduleReveal(); else hide();
    }
    if (restarting) return;
    const t = info.currentTime, dur = info.duration;
    const limit = endS || dur || 0;
    if ((limit && t >= limit - 1.2) || info.playerState === 0) {
      restarting = true;
      hide();
      setTimeout(() => { send("pauseVideo"); send("seekTo", [startS, true]); send("playVideo"); }, 450);
    }
  };
  window.addEventListener("message", onMsg);
  frame.onload = () => frame.contentWindow.postMessage(JSON.stringify({ event: "listening" }), "*");
  box._cleanup = () => { clearTimeout(revealTimer); window.removeEventListener("message", onMsg); };
  box.append(frame);
}

const previewObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    const box = en.target;
    if (en.isIntersecting && !box.firstChild) startPreview(box);
    else if (!en.isIntersecting) { box._cleanup?.(); box._cleanup = null; box.replaceChildren(); }
  });
}, { rootMargin: "100px" });

function observePreview(box, i, id) {
  Object.assign(box.dataset, { id, start: i.start || 0, end: i.end || 0 });
  previewObserver.observe(box);
}

function card(i) {
  const id = parseYT(i.url);
  const thumb = el("button", { className: "thumb" + (id ? "" : " ig"), type: "button", title: "Assistir", onclick: () => play(i) });
  if (!id && parseIG(i.url)) thumb.dataset.label = "Instagram";
  const preview = el("div", { className: "preview" });
  if (id) {
    preview.style.backgroundImage = `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`;
    observePreview(preview, i, id);
  }
  const tags = el("div", { className: "tags" },
    el("span", { className: "tag", textContent: i.team }),
    el("span", { className: "tag side", textContent: SIDES.find((s) => s.id === i.side)?.name }),
    ...i.tags.map((t) => el("span", { className: "tag", textContent: t })));
  const btns = el("div", { className: "btns admin-only" },
    el("button", { textContent: "Editar", onclick: () => openItem(i) }),
    el("button", { textContent: "Excluir", onclick: () => {
      if (confirm(`Excluir "${i.title}"?`)) { data.items = data.items.filter((x) => x.id !== i.id); save(); render(); }
    } }));
  return el("div", { className: "card" }, el("div", { className: "thumbwrap" }, preview, thumb),
    el("div", { className: "info" }, el("strong", { textContent: i.title }), tags, btns));
}

/* Player: iframe só é criado ao clicar; mudo+autoplay, loop no trecho, sem vídeos relacionados */
function play(i) {
  const id = parseYT(i.url);
  const ig = id ? null : parseIG(i.url);
  if (!id && !ig) return alert("Link inválido (use YouTube ou Instagram).");
  if (ig) {
    const f = el("iframe", {
      src: `https://www.instagram.com/${ig.type}/${ig.code}/embed`,
      allow: "autoplay; encrypted-media; picture-in-picture",       allowFullscreen: true,
    });
    $("ytPlayer").replaceChildren(f);
    $("playerTitle").textContent = i.title;
    $("playerNotes").textContent = i.notes;
    $("playerDlg").classList.remove("vertical");
    $("playerDlg").classList.add("ig");
    $("playerDlg").showModal();
    return;
  }
  $("playerDlg").classList.remove("ig");
  $("playerDlg").classList.toggle("vertical", /youtube\.com\/shorts\//.test(i.url));
  const p = new URLSearchParams({
    autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
    enablejsapi: 1, start: i.start || 0,
  });
  const f = el("iframe", {
    src: `https://www.youtube.com/embed/${id}?${p}`,
    allow: "autoplay; encrypted-media; picture-in-picture", allowFullscreen: true, tabIndex: -1,
  });
  stopPlayerLoop();
  const startS = i.start || 0, endS = i.end || 0;
  const send = (func, args = []) => f.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  let looping = false, playing = false, muted = true, unmuted = false, limit = endS, scrubbing = false;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const paint = () => {
    $("pcPlay").textContent = playing ? "⏸" : "▶";
    $("pcMute").textContent = muted ? "🔇" : "🔊";
  };
  const togglePlay = () => send(playing ? "pauseVideo" : "playVideo");
  $("ytShield").onclick = togglePlay;
  $("pcPlay").onclick = togglePlay;
  $("pcMute").onclick = () => { muted = !muted; send(muted ? "mute" : "unMute"); if (!muted) send("setVolume", [100]); paint(); };
  $("pcFull").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("playerBox").requestFullscreen());
  $("pcSeek").min = startS;
  $("pcSeek").max = limit || startS + 1;
  $("pcSeek").value = startS;
  $("pcSeek").onpointerdown = () => (scrubbing = true);
  $("pcSeek").onpointerup = () => (scrubbing = false);
  $("pcSeek").oninput = (e) => send("seekTo", [Number(e.target.value), true]);
  paint();
  const onMsg = (e) => {
    if (e.source !== f.contentWindow) return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    const info = m.info;
    if (m.event !== "infoDelivery" || !info) return;
    if (info.playerState !== undefined) {
      playing = info.playerState === 1; paint();
      if (playing && !unmuted) { unmuted = true; send("unMute"); send("setVolume", [100]); }
    }
    if (info.muted !== undefined) { muted = info.muted; paint(); }
    if (!endS && info.duration) { limit = info.duration; $("pcSeek").max = limit; }
    if (info.currentTime !== undefined && !scrubbing) {
      $("pcSeek").value = info.currentTime;
      $("pcTime").textContent = fmt(info.currentTime);
    }
    if (looping) return;
    if (info.playerState === 0 || (limit && info.currentTime >= limit - 0.4)) {
      looping = true;
      const opts = { videoId: id, startSeconds: startS };
      if (endS) opts.endSeconds = endS;
      send("loadVideoById", [opts]);
      setTimeout(() => (looping = false), 1000);
    }
  };
  window.addEventListener("message", onMsg);
  f.onload = () => f.contentWindow.postMessage(JSON.stringify({ event: "listening" }), "*");
  playerLoopCleanup = () => window.removeEventListener("message", onMsg);
  $("ytPlayer").replaceChildren(f);
  $("playerTitle").textContent = i.title;
  $("playerNotes").textContent = i.notes;
  $("playerDlg").showModal();
}
let playerLoopCleanup = null;
function stopPlayerLoop() { playerLoopCleanup?.(); playerLoopCleanup = null; }
$("playerClose").onclick = () => $("playerDlg").close();
$("playerDlg").addEventListener("close", () => { stopPlayerLoop(); $("ytPlayer").replaceChildren(); });
$("playerDlg").addEventListener("click", (e) => { if (e.target === $("playerDlg")) $("playerDlg").close(); });

/* Formulário de utilitária */
function openItem(item = null) {
  if (!data.maps.length) return alert("Crie um mapa primeiro.");
  state.editing = item;
  const f = $("itemForm");
  f.reset();
  f.map.replaceChildren(...data.maps.map((m) => el("option", { value: m.id, textContent: m.name })));
  f.side.replaceChildren(...SIDES.map((s) => el("option", { value: s.id, textContent: s.name })));
  f.team.replaceChildren(...TEAMS.map((s) => el("option", { value: s.id, textContent: s.name })));
  const v = item || { title: "", map: state.map, team: state.team === "all" ? "TR" : state.team, side: state.side === "all" ? "A" : state.side, url: "", start: 0, end: null, tags: [], notes: "" };
  f.title.value = v.title; f.map.value = v.map; f.side.value = v.side; f.team.value = v.team || "TR"; f.url.value = v.url;
  f.start.value = v.start || 0; f.end.value = v.end || ""; f.notes.value = v.notes;
  $("itemTags").replaceChildren(...data.tags.map((t) =>
    el("label", { style: "flex-direction:row;display:inline-flex;gap:4px;margin-right:10px" },
      el("input", { type: "checkbox", value: t, checked: v.tags.includes(t) }), t)));
  $("itemDlg").showModal();
}
$("btnAdd").onclick = () => openItem();
$("itemCancel").onclick = () => $("itemDlg").close();
$("itemForm").onsubmit = (e) => {
  const f = e.target;
  if (!isValidVideo(f.url.value)) { e.preventDefault(); return alert("Link inválido. Use um link do YouTube ou do Instagram (reel/post)."); }
  const v = {
    id: state.editing?.id || uid(),
    title: f.title.value.trim(), map: f.map.value, team: f.team.value, side: f.side.value, url: f.url.value.trim(),
    start: Number(f.start.value) || 0, end: f.end.value ? Number(f.end.value) : null,
    tags: [...$("itemTags").querySelectorAll("input:checked")].map((c) => c.value),
    notes: f.notes.value.trim(),
  };
  if (state.editing) data.items = data.items.map((x) => (x.id === v.id ? v : x));
  else data.items.push(v);
  state.map = v.map;
  save(); render();
};

/* Mapas e tags */
function renderManage() {
  $("mapList").replaceChildren(...data.maps.map((m) => el("li", {}, m.name,
    el("button", { textContent: "Remover", onclick: () => {
      const n = data.items.filter((i) => i.map === m.id).length;
      if (!confirm(`Remover "${m.name}"${n ? ` e suas ${n} utilitárias` : ""}?`)) return;
      data.maps = data.maps.filter((x) => x.id !== m.id);
      data.items = data.items.filter((i) => i.map !== m.id);
      save(); renderManage(); render();
    } }))));
  $("tagList").replaceChildren(...data.tags.map((t) => el("li", {}, t,
    el("button", { textContent: "Remover", onclick: () => {
      data.tags = data.tags.filter((x) => x !== t);
      data.items.forEach((i) => (i.tags = i.tags.filter((x) => x !== t)));
      save(); renderManage(); render();
    } }))));
}
$("btnManage").onclick = () => { renderManage(); $("manageDlg").showModal(); };
$("manageClose").onclick = () => $("manageDlg").close();
$("mapForm").onsubmit = (e) => {
  e.preventDefault();
  const name = $("newMap").value.trim();
  let id = slug(name);
  while (data.maps.some((m) => m.id === id)) id += "-" + uid().slice(0, 3);
  data.maps.push({ id, name });
  $("newMap").value = "";
  save(); renderManage(); render();
};
$("tagForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("newTag").value.trim();
  if (t && !data.tags.includes(t)) data.tags.push(t);
  $("newTag").value = "";
  save(); renderManage(); render();
};

/* Import / Export */
$("btnExport").onclick = () => {
  const a = el("a", {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })),
    download: "data.json",
  });
  a.click();
  URL.revokeObjectURL(a.href);
};
$("btnImport").onclick = () => $("fileImport").click();
$("fileImport").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const d = normalize(JSON.parse(await file.text()));
    if (!confirm("Isso substitui todos os dados atuais. Continuar?")) return;
    data = d;
    state.map = data.maps[0]?.id ?? null;
    save(); render();
  } catch (err) {
    alert("Arquivo inválido: " + err.message);
  }
};

$("search").oninput = (e) => { state.q = e.target.value; render(); };

/* Chave de acesso: só o hash fica no código. Para trocar a chave, rode hashKey("nova") no console e cole o resultado em KEY_HASH. */
const KEY_HASH = "ad8571af96d7638bf3246607b405fc395b295b354cb3b50c08b33be6ca5c6622";
const KEY_SALT = "utilitybook-cs-v1";
const AUTH = "cs-utils-auth";
async function hashKey(k) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(k), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(KEY_SALT), iterations: 100000, hash: "SHA-256" }, base, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
window.hashKey = hashKey;
function setAdmin(on) {
  document.body.classList.toggle("admin", on);
  $("btnKey").textContent = on ? "🔓 Sair" : "🔑 Chave";
  if (on) localStorage.setItem(AUTH, KEY_HASH); else localStorage.removeItem(AUTH);
}
$("btnKey").onclick = () => {
  if (document.body.classList.contains("admin")) return setAdmin(false);
  $("keyInput").value = ""; $("keyErr").textContent = "";
  $("keyDlg").showModal();
};
$("keyCancel").onclick = () => $("keyDlg").close();
$("keyForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!crypto.subtle) { $("keyErr").textContent = "Abra por http://localhost (não por arquivo)."; return; }
  if (await hashKey($("keyInput").value.trim()) === KEY_HASH) { setAdmin(true); $("keyDlg").close(); }
  else $("keyErr").textContent = "Chave incorreta.";
};
setAdmin(localStorage.getItem(AUTH) === KEY_HASH);

load();
