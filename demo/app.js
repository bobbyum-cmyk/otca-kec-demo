const KEY = "otca-kec-demo-v1";
const COLUMNS = [
  { id: "backlog", name: "Backlog" },
  { id: "doing", name: "In progress" },
  { id: "ready", name: "Ready" },
  { id: "done", name: "Done" },
];
const STATUSES = ["standby", "ready", "running", "charging", "attention"];
const DELIVERIES = [
  { id: "planned", en: "Planned", zh: "计划中", pill: "muted" },
  { id: "ordered", en: "Ordered", zh: "已下单", pill: "muted" },
  { id: "shipped", en: "Shipped", zh: "已发货", pill: "sky" },
  { id: "transit", en: "In transit", zh: "运输中", pill: "sky" },
  { id: "customs", en: "Customs", zh: "清关中", pill: "" },
  { id: "delivered", en: "Delivered", zh: "已送达", pill: "mint" },
  { id: "onsite", en: "On site", zh: "已到场", pill: "mint" },
  { id: "ready", en: "Ready", zh: "已就位", pill: "mint" },
  { id: "hold", en: "Hold", zh: "异常", pill: "blocker" },
];
const ARRIVED = new Set(["delivered", "onsite", "ready"]);
const DEVICE_TYPES = ["AMR", "Robot dog", "Drone", "Other"];
const OWNER_IDS = { "Site lead": "site", "AMR operator": "amr", "Dog handler": "dog", "Drone pilot": "drone", "Demo host": "host" };
const ROLE_TO_PERSON = { site: "wilson", host: "chi-wai", amr: "erk", dog: "pong", drone: "fu-pan" };

const app = document.querySelector("#app");
let hadLocal = false;
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    hadLocal = !!raw;
    if (!raw) return fresh();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.robots)) return fresh();
    if (saved.version === window.OTCA_SEED.version) {
      saved.presenter = false;
      saved.confirmReset = false;
      saved.ownerFilter = saved.ownerFilter || "all";
      saved.assignees = Array.isArray(saved.assignees) ? saved.assignees : structuredClone(window.OTCA_SEED.assignees);
      saved.devices = (Array.isArray(saved.devices) ? saved.devices : structuredClone(window.OTCA_SEED.devices)).map(withDelivery);
      saved.zones = (saved.zones || structuredClone(window.OTCA_SEED.zones)).map((zone) => {
        const seed = window.OTCA_SEED.zones.find((item) => item.id === zone.id);
        return { ...zone, nameZh: zone.nameZh || (seed && seed.nameZh) || "", note: (seed && seed.note) || zone.note };
      });
      saved.steps = (saved.steps || []).map((step) => {
        const seed = window.OTCA_SEED.steps.find((item) => item.id === step.id);
        return { ...step, titleZh: step.titleZh || (seed && seed.titleZh) || "", cues: step.cues || [], robots: step.robots || [] };
      });
      if (!saved.cleaningRun) ensureCleaningRun(saved);
      linkDevicesToFleet(saved);
      if (saved.roster !== 1) applyRoster(saved);
      saved.checks = window.OTCA_SEED.checks.map((item) => {
        const old = (saved.checks || []).find((check) => check.id === item.id);
        return old ? { ...item, done: !!old.done } : structuredClone(item);
      });
      return saved;
    }
    if (saved.version === 3) return migrateTasks(saved);
    if (saved.version === 2) return migrateFrom2(saved);
    return fresh();
  } catch (err) {
    return fresh();
  }
}

function migrateFrom2(saved) {
  const next = fresh();
  next.demoDate = saved.demoDate || next.demoDate;
  next.startTime = saved.startTime || next.startTime;
  next.audience = saved.audience || next.audience;
  next.scriptFilter = saved.scriptFilter || next.scriptFilter;
  next.checks = next.checks.map((item) => {
    const old = (saved.checks || []).find((check) => check.id === item.id);
    return old ? { ...item, done: !!old.done } : item;
  });
  next.steps = next.steps.map((step) => {
    const old = (saved.steps || []).find((item) => item.id === step.id);
    return old ? { ...step, status: old.status || step.status, note: old.note || "" } : step;
  });
  next.robots = next.robots.map((robot) => {
    const old = saved.robots.find((item) => item.id === robot.id);
    return old ? { ...robot, status: old.status, battery: old.battery, now: old.now } : robot;
  });
  if (Array.isArray(saved.issues)) next.issues = saved.issues;
  if (Array.isArray(saved.counts)) next.counts = saved.counts;
  if (Array.isArray(saved.log)) next.log = saved.log;
  const live = (saved.steps || []).find((step) => step.status === "live");
  next.liveStepId = live ? live.id : null;
  return next;
}

function migrateTasks(saved) {
  const next = migrateFrom2(saved);
  const seedTasks = window.OTCA_SEED.tasks;
  const oldTasks = Array.isArray(saved.tasks) ? saved.tasks : [];
  next.tasks = seedTasks.map((seed) => {
    const old = oldTasks.find((task) => task.id === seed.id);
    if (!old) return seed;
    return {
      ...seed,
      title: old.title || seed.title,
      titleZh: old.titleZh || seed.titleZh,
      column: old.column || seed.column,
      due: old.due ?? seed.due,
      priority: old.priority || seed.priority,
      robotId: old.robotId ?? seed.robotId,
      gate: typeof old.gate === "boolean" ? old.gate : seed.gate,
      owner: ROLE_TO_PERSON[OWNER_IDS[old.owner] || old.owner] || OWNER_IDS[old.owner] || old.owner || seed.owner,
    };
  });
  oldTasks.filter((task) => !seedTasks.some((seed) => seed.id === task.id)).forEach((task) => {
    next.tasks.push({
      ...task,
      titleZh: task.titleZh || "",
      owner: ROLE_TO_PERSON[OWNER_IDS[task.owner] || task.owner] || OWNER_IDS[task.owner] || task.owner,
    });
  });
  return next;
}

function applyRoster(saved) {
  const oldRoles = new Set(["site", "amr", "dog", "drone", "host"]);
  const seed = structuredClone(window.OTCA_SEED.assignees);
  const seedNames = new Set(seed.flatMap((person) => [person.name, person.nameZh].map((value) => String(value || "").toLowerCase())));
  const extras = (saved.assignees || []).filter((person) => !oldRoles.has(person.id) && !seed.some((item) => item.id === person.id) && !seedNames.has(String(person.name || "").toLowerCase()));
  saved.assignees = seed.concat(extras);
  const known = new Set(saved.assignees.map((person) => person.id));
  (saved.tasks || []).forEach((task) => {
    const next = ROLE_TO_PERSON[task.owner] || task.owner;
    task.owner = known.has(next) ? next : "chi-wai";
  });
  const filtered = ROLE_TO_PERSON[saved.ownerFilter] || saved.ownerFilter;
  saved.ownerFilter = filtered === "all" || known.has(filtered) ? filtered : "all";
  saved.roster = 1;
}

function fresh() {
  const next = structuredClone(window.OTCA_SEED);
  next.view = "dashboard";
  next.presenter = false;
  next.drawer = null;
  next.liveStepId = null;
  next.stepStartedAt = null;
  next.confirmReset = false;
  next.log = [];
  return next;
}

function writeLocal() {
  const copy = { ...state, presenter: false, confirmReset: false, revealId: null };
  localStorage.setItem(KEY, JSON.stringify(copy));
}

function save() {
  state.sharedAt = Date.now();
  dirtyUntil = Date.now() + 2000;
  writeLocal();
  schedulePublish();
}

const SHARE_URL = "https://ntfy.sh/otca-kec-7f3a9c2e8b14d6a0c5e1b8d4";
let shareLabel = "Sharing with the team…";
let shareStarted = false;
let publishTimer = 0;
let dirtyUntil = 0;
let lastPublishAt = 0;
let syncing = false;

function snapshot() {
  return {
    sharedAt: state.sharedAt || 0,
    demoDate: state.demoDate,
    startTime: state.startTime,
    audience: state.audience,
    scriptFilter: state.scriptFilter,
    assignees: state.assignees,
    devices: state.devices,
    tasks: state.tasks,
    checks: state.checks,
    issues: state.issues,
    counts: state.counts,
    steps: state.steps,
    log: state.log,
    liveStepId: state.liveStepId,
    robots: (state.robots || []).map((robot) => ({ id: robot.id, status: robot.status, now: robot.now })),
  };
}

function paintShare() {
  const node = document.querySelector("[data-share]");
  if (node) node.textContent = shareLabel;
}

function schedulePublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publish().catch(() => {
      shareLabel = "Could not share. This browser still has your copy.";
      paintShare();
    });
  }, 700);
}

async function publish() {
  lastPublishAt = Date.now();
  shareLabel = "Sharing…";
  paintShare();
  const response = await fetch(SHARE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot()),
  });
  if (!response.ok) throw new Error("share");
  shareLabel = "Saved for the team";
  paintShare();
}

async function pullLatest() {
  const response = await fetch(`${SHARE_URL}/json?poll=1&since=6h`, { cache: "no-store" });
  if (!response.ok) return null;
  const text = await response.text();
  const events = text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (err) { return null; }
  }).filter(Boolean);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.event !== "message") continue;
    if (event.attachment && event.attachment.url) {
      const file = await fetch(event.attachment.url, { cache: "no-store" });
      if (!file.ok) continue;
      const data = await file.json();
      if (data && data.sharedAt) return data;
    }
    if (typeof event.message === "string" && event.message.startsWith("{")) {
      try {
        const data = JSON.parse(event.message);
        if (data && data.sharedAt) return data;
      } catch (err) { /* the notice is not a desk snapshot */ }
    }
  }
  return null;
}

function applyRemote(snap) {
  const keep = {
    view: state.view,
    presenter: state.presenter,
    drawer: state.drawer,
    confirmReset: false,
    revealId: null,
    ownerFilter: state.ownerFilter,
    phaseFilter: state.phaseFilter,
  };
  state.demoDate = snap.demoDate || state.demoDate;
  state.startTime = snap.startTime || state.startTime;
  state.audience = snap.audience || state.audience;
  state.scriptFilter = snap.scriptFilter || state.scriptFilter;
  if (Array.isArray(snap.assignees)) state.assignees = snap.assignees;
  if (Array.isArray(snap.devices)) state.devices = snap.devices;
  if (Array.isArray(snap.tasks)) state.tasks = snap.tasks;
  if (Array.isArray(snap.checks)) state.checks = snap.checks;
  if (Array.isArray(snap.issues)) state.issues = snap.issues;
  if (Array.isArray(snap.counts)) state.counts = snap.counts;
  if (Array.isArray(snap.steps)) state.steps = snap.steps;
  if (Array.isArray(snap.log)) state.log = snap.log;
  state.liveStepId = snap.liveStepId || null;
  state.sharedAt = snap.sharedAt || 0;
  Object.assign(state, keep);
  linkDevicesToFleet(state);
  (snap.robots || []).forEach((incoming) => {
    const robot = state.robots.find((item) => item.id === incoming.id);
    if (!robot) return;
    if (incoming.status) robot.status = incoming.status;
    if (typeof incoming.now === "string") robot.now = incoming.now;
  });
  writeLocal();
  shareLabel = "Saved for the team";
  render();
}

async function syncFromTeam() {
  if (syncing || !deskUnlocked()) return;
  syncing = true;
  try {
    const remote = await pullLatest();
    const localStamp = state.sharedAt || 0;
    const remoteStamp = (remote && remote.sharedAt) || 0;
    if (remote && remoteStamp > localStamp && Date.now() >= dirtyUntil) {
      const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("input, textarea, select");
      if (!typing) applyRemote(remote);
      return;
    }
    if (hadLocal && !localStamp) {
      state.sharedAt = Date.now();
      writeLocal();
      await publish();
      return;
    }
    if (localStamp > remoteStamp && Date.now() - lastPublishAt > 20000) {
      await publish();
      return;
    }
    shareLabel = remote || localStamp ? "Saved for the team" : shareLabel;
    paintShare();
  } catch (err) {
    shareLabel = "Could not share. This browser still has your copy.";
    paintShare();
  } finally {
    syncing = false;
  }
}

function startShare() {
  syncFromTeam();
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    syncFromTeam();
  }, 12000);
  setInterval(() => {
    if (document.visibilityState === "hidden" || !state.sharedAt) return;
    publish().catch(() => {});
  }, 15 * 60 * 1000);
  window.addEventListener("focus", () => { syncFromTeam(); });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function robotById(id) {
  return state.robots.find((robot) => robot.id === id);
}

function assigneeById(id) {
  return (state.assignees || []).find((person) => person.id === id);
}

function withDelivery(device) {
  const seed = (window.OTCA_SEED.devices || []).find((item) => item.id === device.id) || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(device, key);
  return {
    ...device,
    delivery: has("delivery") ? device.delivery : "planned",
    eta: has("eta") ? device.eta : (seed.eta || ""),
    place: has("place") ? device.place : "",
    note: has("note") ? device.note : "",
  };
}

function deliveryOf(id) {
  return DELIVERIES.find((item) => item.id === id) || DELIVERIES[0];
}

function deviceById(id) {
  return (state.devices || []).find((device) => device.id === id);
}

function homeFor(type) {
  if (type === "Robot dog") return "cables";
  if (type === "Other") return "audience";
  return "nest";
}

function markFrom(label) {
  return String(label || "?").replace(/\s+/g, "").slice(0, 2);
}

function blankRobot(device) {
  const type = DEVICE_TYPES.includes(device.type) ? device.type : "Other";
  return {
    id: device.id,
    short: markFrom(device.nameZh || device.name),
    callSign: device.name,
    localName: device.nameZh || "",
    type,
    model: "",
    nav: "",
    status: "standby",
    battery: 0,
    home: homeFor(type),
    now: device.place || "Not on the floor",
    role: device.note || "Added from the device list.",
    specs: [],
    abilities: [],
    limits: [],
    chain: [],
    custom: true,
  };
}

function pointCleaning(step, robotId) {
  const copy = structuredClone(step);
  copy.robots = (copy.robots || []).map((id) => (id === "clean-1" ? robotId : id));
  if (copy.places && copy.places["clean-1"]) {
    copy.places[robotId] = copy.places["clean-1"];
    if (robotId !== "clean-1") delete copy.places["clean-1"];
  }
  return copy;
}

function ensureCleaningRun(saved) {
  const named = (saved.devices || []).find((device) => device.id === "clean-1" || /清洁|cleaning/i.test(`${device.name || ""} ${device.nameZh || ""}`));
  if (!named) {
    saved.devices.push(structuredClone(window.OTCA_SEED.devices.find((device) => device.id === "clean-1")));
  }
  const device = (saved.devices || []).find((item) => item.id === "clean-1" || /清洁|cleaning/i.test(`${item.name || ""} ${item.nameZh || ""}`));
  if (!saved.robots.some((robot) => robot.id === device.id)) {
    const robot = structuredClone(window.OTCA_SEED.robots.find((item) => item.id === "clean-1"));
    robot.id = device.id;
    robot.callSign = device.name || robot.callSign;
    robot.localName = device.nameZh || robot.localName;
    robot.short = markFrom(device.nameZh || device.name);
    if (device.type) robot.type = device.type;
    robot.custom = device.id !== "clean-1";
    saved.robots.push(robot);
  }
  const robotId = device.id;
  ["s16", "s17"].forEach((id) => {
    if (saved.steps.some((step) => step.id === id)) return;
    const seed = pointCleaning(window.OTCA_SEED.steps.find((step) => step.id === id), robotId);
    const at = saved.steps.findIndex((step) => step.id === (id === "s16" ? "s17" : "s15"));
    const fallback = saved.steps.findIndex((step) => step.id === "s15");
    const index = at >= 0 ? at : fallback;
    saved.steps.splice(index < 0 ? saved.steps.length : index, 0, seed);
  });
  const park = saved.steps.find((step) => step.id === "s15");
  if (park && !(park.robots || []).includes(robotId)) {
    park.robots = [...(park.robots || []), robotId];
    park.places = { ...(park.places || {}), [robotId]: "nest" };
  }
  const welcome = saved.steps.find((step) => step.id === "s1");
  const seedWelcome = window.OTCA_SEED.steps.find((step) => step.id === "s1");
  const seedCue = (seedWelcome.cues || []).find((cue) => /cleaning/i.test(cue));
  if (welcome && seedCue && !(welcome.cues || []).some((cue) => /清洁|cleaning/i.test(cue))) welcome.cues.push(seedCue);
  const task = window.OTCA_SEED.tasks.find((item) => item.id === "t18");
  if (task && !(saved.tasks || []).some((item) => item.id === "t18")) {
    saved.tasks = saved.tasks || [];
    saved.tasks.push({ ...structuredClone(task), robotId });
  }
  saved.cleaningRun = true;
}

function linkDevicesToFleet(saved) {
  saved.robots = Array.isArray(saved.robots) ? saved.robots : [];
  (saved.devices || []).forEach((device) => {
    let robot = saved.robots.find((item) => item.id === device.id);
    if (!robot) {
      device.type = device.type || "Other";
      saved.robots.push(blankRobot(device));
      return;
    }
    device.type = device.type || robot.type || "Other";
    if (device.name) robot.callSign = device.name;
    robot.type = device.type;
    if (robot.custom) {
      robot.localName = device.nameZh || robot.localName;
      robot.short = markFrom(device.nameZh || device.name);
      if (device.place) robot.now = device.place;
    }
  });
}

function robotNames(robot) {
  const device = robot && deviceById(robot.id);
  const zh = (device && device.nameZh) || "";
  const en = (device && device.name) || (robot && robot.callSign) || "";
  return { zh, en, title: zh || en };
}

function zoneLabel(zone) {
  if (!zone) return "";
  return zone.nameZh ? `${zone.nameZh} · ${zone.name}` : zone.name;
}

function personLabel(person) {
  if (!person) return "";
  return person.nameZh ? `${person.nameZh} · ${person.name}` : person.name;
}

function assigneeOptions(selected) {
  return (state.assignees || []).map((person) => `
    <option value="${esc(person.id)}" ${person.id === selected ? "selected" : ""}>${esc(personLabel(person))}</option>`).join("");
}

function deviceOptions(selected) {
  const blank = `<option value="" ${selected ? "" : "selected"}>不指定设备 · No device</option>`;
  return blank + (state.devices || []).map((device) => `
    <option value="${esc(device.id)}" ${device.id === selected ? "selected" : ""}>${esc(personLabel(device))} · ${esc(deliveryOf(device.delivery).zh)}</option>`).join("");
}

function stepById(id) {
  return state.steps.find((step) => step.id === id);
}

function visibleSteps() {
  if (state.scriptFilter === "all") return state.steps;
  return state.steps.filter((step) => step.tier === state.scriptFilter);
}

function zoneFor(robot) {
  const step = state.liveStepId ? stepById(state.liveStepId) : null;
  if (step && step.robots.includes(robot.id)) {
    return (step.places && step.places[robot.id]) || step.zone;
  }
  return robot.home;
}

function phaseName(id) {
  return state.phases.find((phase) => phase.id === id)?.name || id;
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysUntil(iso) {
  const start = new Date(`${todayISO()}T00:00:00`);
  const end = new Date(`${iso}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function fmtDate(iso) {
  if (!iso) return "Not set";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]}`;
}

function taskTiming(task) {
  if (task.column === "done") return "done";
  if (!task.due) return "open";
  const today = todayISO();
  if (task.gate && task.due >= state.setupDeadline) return "overdue";
  if (task.due < today) return "overdue";
  const due = new Date(`${task.due}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  if ((due - now) / 86400000 <= 3) return "soon";
  return "open";
}

function setupSummary() {
  const tasks = state.tasks.filter((task) => task.gate);
  return {
    tasks,
    done: tasks.filter((task) => task.column === "done").length,
    total: tasks.length,
    overdue: tasks.filter((task) => taskTiming(task) === "overdue").length,
    soon: tasks.filter((task) => taskTiming(task) === "soon").length,
    left: daysUntil(state.setupDeadline),
  };
}

function fmtMinutes(total) {
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function withTimes(steps) {
  const [h, m] = String(state.startTime || "09:30").split(":").map(Number);
  let cursor = (h || 0) * 60 + (m || 0);
  return steps.map((step) => {
    const start = cursor;
    cursor += step.minutes;
    return { step, start, end: cursor };
  });
}

function elapsed() {
  if (!state.stepStartedAt) return "00:00";
  const secs = Math.max(0, Math.floor((Date.now() - state.stepStartedAt) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  state.log.unshift({ id: `l${Date.now()}`, message, stamp });
  state.log = state.log.slice(0, 12);
}

function statusClass(status) {
  if (status === "ready" || status === "done") return "mint";
  if (status === "charging") return "sky";
  if (status === "attention" || status === "blocker") return "blocker";
  if (status === "standby") return "muted";
  return "";
}

function typeClass(type) {
  if (type === "Robot dog") return "dog";
  if (type === "Drone") return "sky";
  return "";
}

function mutate(fn) {
  fn();
  save();
  render();
}

function goLive(id) {
  const step = stepById(id);
  state.steps.forEach((item) => {
    if (item.status === "live" && item.id !== id) item.status = "pending";
  });
  step.status = "live";
  state.liveStepId = id;
  state.stepStartedAt = Date.now();
  state.robots.forEach((robot) => {
    if (step.robots.includes(robot.id)) robot.status = "running";
    else if (robot.status === "running") robot.status = "ready";
  });
  log(`Live: ${step.title}`);
}

function completeStep(id, advance) {
  const step = stepById(id);
  step.status = "done";
  if (state.liveStepId === id) {
    state.liveStepId = null;
    state.stepStartedAt = null;
  }
  state.robots.forEach((robot) => {
    if (step.robots.includes(robot.id) && robot.status === "running") robot.status = "ready";
  });
  log(`Completed: ${step.title}`);
  if (!advance) return;
  const list = visibleSteps();
  const index = list.findIndex((item) => item.id === id);
  const next = list.slice(index + 1).find((item) => item.status !== "done");
  if (next) goLive(next.id);
}

const GATE_KEY = "otca-kec-gate";
const GATE_HASH = "80046182f07eb8eaa888af9adfcaa7967ceb3e8c28414e3d1edf996ae8141112";

function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const maxWord = 2 ** 32;
  let result = "";
  const words = [];
  const bitLength = ascii.length * 8;
  const hash = [];
  const k = [];
  const isComposite = {};
  for (let candidate = 2, primeCounter = 0; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
      k[primeCounter++] = (candidate ** (1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while ((ascii.length % 64) - 56) ascii += "\x00";
  for (let i = 0; i < ascii.length; i++) words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i) % 4) * 8;
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 = (hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0)) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;
      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let n = 3; n >= 0; n--) {
      const b = (hash[i] >> (n * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

function deskUnlocked() {
  return sessionStorage.getItem(GATE_KEY) === "1";
}

function showGate(message) {
  app.innerHTML = `
    <form class="gate" data-form="gate">
      <div class="mark" aria-hidden="true"></div>
      <h1>OTCA · KEC</h1>
      <p>Enter the team password to open the demonstration desk.</p>
      <input name="password" type="password" autocomplete="current-password" placeholder="Password" autofocus required>
      ${message ? `<p class="gate-error">${esc(message)}</p>` : ""}
      <button class="btn primary" type="submit">Open</button>
    </form>`;
  const field = app.querySelector("input");
  if (field) field.focus();
}

function render() {
  if (!deskUnlocked()) {
    showGate("");
    return;
  }
  const main = document.querySelector(".main");
  const scroll = main ? main.scrollTop : 0;
  const hash = state.presenter ? "present" : state.view;
  if (location.hash !== `#${hash}`) history.replaceState(null, "", `#${hash}`);
  app.innerHTML = state.presenter ? presenter() : shell();
  const next = document.querySelector(".main");
  if (state.revealId && next) {
    const beat = next.querySelector(`[data-step="${String(state.revealId).replace(/[^a-zA-Z0-9_-]/g, "")}"]`);
    if (beat) {
      try { beat.scrollIntoView({ block: "center" }); } catch (err) { /* keep the beat saved if the view cannot scroll */ }
    }
    state.revealId = null;
  } else if (next) next.scrollTop = scroll;
  paintShare();
  if (!shareStarted) {
    shareStarted = true;
    startShare();
  }
}

function shell() {
  const setup = setupSummary();
  const views = [
    ["dashboard", "Dashboard", ""],
    ["status", "Status", setup.overdue ? String(setup.overdue) : `${setup.done}/${setup.total}`],
    ["fleet", "Fleet", ""],
    ["script", "Run sheet", `${state.steps.filter((s) => s.tier === "core" && s.status === "done").length}/${state.steps.filter((s) => s.tier === "core").length}`],
    ["board", "Board", String(state.tasks.filter((t) => t.column !== "done").length)],
    ["schedule", "Schedule", ""],
  ];
  return `
    <div class="shell">
      <header class="top">
        <div class="brand">
          <div class="mark" aria-hidden="true"></div>
          <div>
            <h1>OTCA · KEC</h1>
            <p>Bangkok warehouse demonstration</p>
          </div>
        </div>
        <div class="meta">
          <label class="field"><span>Date</span><input data-meta="demoDate" type="date" value="${esc(state.demoDate)}"></label>
          <label class="field"><span>Start</span><input data-meta="startTime" type="time" value="${esc(state.startTime)}"></label>
          <label class="field"><span>Audience</span><input class="audience" data-meta="audience" type="text" value="${esc(state.audience)}"></label>
        </div>
      </header>
      <div class="layout">
        <nav class="nav">
          ${views.map(([id, label, badge]) => `
            <button type="button" data-action="view" data-view="${id}" class="${state.view === id ? "on" : ""}">
              ${label}${badge ? `<em>${badge}</em>` : ""}
            </button>`).join("")}
          <div class="nav-foot">
            <p>Figures follow the AMR, LYNX M20, and Jiaxinlian manuals in this project. Warehouse results will differ.</p>
            <p data-share>${esc(shareLabel)}</p>
          </div>
        </nav>
        <main class="main">${view()}</main>
      </div>
      ${printSheet()}
    </div>`;
}

function view() {
  if (state.view === "status") return statusView();
  if (state.view === "fleet") return state.drawer ? fleetDetail(state.drawer) : fleet();
  if (state.view === "script") return script();
  if (state.view === "board") return board();
  if (state.view === "schedule") return schedule();
  return dashboard();
}

function readiness() {
  const done = state.checks.filter((item) => item.done).length;
  return { done, total: state.checks.length };
}

function dashboard() {
  const readyRobots = state.robots.filter((robot) => robot.status === "ready" || robot.status === "charging").length;
  const core = state.steps.filter((step) => step.tier === "core");
  const coreDone = core.filter((step) => step.status === "done").length;
  const blockers = state.issues.filter((issue) => issue.open && issue.severity === "blocker").length;
  const ready = readiness();
  const setup = setupSummary();
  const upcoming = state.steps.find((step) => step.status !== "done");
  const nextSetup = setup.tasks
    .filter((task) => task.column !== "done")
    .slice()
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .slice(0, 5);
  return `
    <p class="notice">This desk plans and records the demonstration. It does not connect to the robots or send tasks to them.</p>
    <div class="page-head">
      <div>
        <h2>Demonstration desk</h2>
        <p class="lede">The AMRs run point A to B to C to D. The drone flies the warehouse stock take. The LYNX M20 checks cables, machine noise, and rack alignment. The cleaning robot sweeps its path, then returns to charge. Audience: ${esc(state.audience)}.</p>
      </div>
      <button type="button" class="btn primary" data-action="present">Open presenter</button>
    </div>
    <section class="stats">
      <article class="stat"><i>Fleet</i><b>${readyRobots}/${state.robots.length}</b><span>ready or on charge</span></article>
      <article class="stat"><i>Core script</i><b>${coreDone}/${core.length}</b><span>beats completed</span></article>
      <article class="stat"><i>Rehearsal setup</i><b>${setup.done}/${setup.total}</b><span>${setup.left > 0 ? `${setup.left} days before 11 Nov` : "11 Nov deadline is here"}</span></article>
      <article class="stat"><i>Go-live</i><b>${ready.done}/${ready.total}</b><span>${blockers ? `${blockers} blocker${blockers > 1 ? "s" : ""}` : "no blockers"}</span></article>
    </section>
    <section class="card" style="margin-bottom:14px">
      <h3>Setup before 11 Nov</h3>
      <p class="now">${setup.overdue} late · ${setup.soon} due within 3 days · last setup day is 10 Nov</p>
      ${nextSetup.map((task) => `
        <div class="issue">
          <span><strong class="due ${taskTiming(task)}">${esc(fmtDate(task.due))}</strong> ${esc(task.titleZh || task.title)}<br><span class="now">${esc(task.title)}</span></span>
          <em class="pill ${taskTiming(task) === "overdue" ? "blocker" : "muted"}">${esc(personLabel(assigneeById(task.owner)) || task.owner)}</em>
        </div>`).join("")}
      <button type="button" class="btn" data-action="view" data-view="status" style="margin-top:10px">Open the breakdown</button>
    </section>
    <section class="card" style="margin-bottom:14px">
      <h3>Devices 设备到货</h3>
      <p class="now">${deviceArrival().arrived} of ${deviceArrival().total} delivered, on site, or ready</p>
      ${(state.devices || []).map((device) => {
        const status = deliveryOf(device.delivery);
        const late = device.eta && device.eta < todayISO() && !ARRIVED.has(device.delivery);
        return `<div class="issue">
          <span>${esc(device.nameZh || device.name)} <span class="now">${esc(device.name)}${device.place ? ` · ${esc(device.place)}` : ""}</span></span>
          <span><em class="pill ${status.pill}">${esc(status.zh)}</em> <strong class="due ${late ? "overdue" : ""}">${esc(fmtDate(device.eta))}</strong></span>
        </div>`;
      }).join("")}
    </section>
    <div class="split">
      <div class="stack">
        <section class="card">
          <h3>Floor</h3>
          ${floor()}
        </section>
        <section class="card">
          <h3>Go-live checks</h3>
          ${state.checks.map((item) => `
            <label class="check ${item.done ? "done" : ""}">
              <input type="checkbox" data-action="check" data-id="${item.id}" ${item.done ? "checked" : ""}>
              <span>${esc(item.label)}</span>
            </label>`).join("")}
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h3>Next beat</h3>
          ${upcoming ? `
            <div class="next-step">
              <div>
                <strong>${esc(upcoming.title)}</strong>
                <p class="now">${upcoming.minutes} min · ${esc(upcoming.tier)}</p>
                <p>${esc(upcoming.audience)}</p>
              </div>
              <button type="button" class="btn small primary" data-action="live" data-id="${upcoming.id}">Go live</button>
            </div>` : `<p>Every beat is marked done.</p>`}
        </section>
        <section class="card">
          <h3>Open issues</h3>
          ${state.issues.filter((issue) => issue.open).map(issueRow).join("") || "<p class='now'>Nothing open.</p>"}
          <form class="row-form" data-form="issue" style="margin-top:10px">
            <input class="grow" name="title" placeholder="Add an issue" required>
            <select name="severity"><option value="watch">Watch</option><option value="blocker">Blocker</option></select>
            <button class="btn" type="submit">Add</button>
          </form>
        </section>
        <section class="card">
          <h3>Activity</h3>
          ${state.log.length ? state.log.map((item) => `<div class="log-item"><span>${esc(item.message)}</span><span class="now">${esc(item.stamp)}</span></div>`).join("") : "<p class='now'>Marks on the run sheet will show up here.</p>"}
        </section>
      </div>
    </div>`;
}

function floor() {
  return `<div class="floor">${state.zones.map((zone) => {
    const tokens = state.robots.filter((robot) => zoneFor(robot) === zone.id);
    const live = state.liveStepId && tokens.some((robot) => stepById(state.liveStepId).robots.includes(robot.id));
    return `
      <section class="zone z-${zone.id} ${live ? "live" : ""}">
        <header><strong>${esc(zone.nameZh || zone.name)}</strong><em>${esc(zone.nameZh ? `${zone.name} · ${zone.note}` : zone.note)}</em></header>
        <div class="tokens">
          ${tokens.map((robot) => `<span class="token" style="--c:${robotColor(robot)}" title="${esc(robotNames(robot).title)}">${esc(markFrom(robotNames(robot).zh || robot.short))}</span>`).join("")}
        </div>
      </section>`;
  }).join("")}</div>`;
}

function robotColor(robot) {
  if (robot.type === "Robot dog") return "var(--dog)";
  if (robot.type === "Drone") return "var(--sky)";
  return "var(--amber)";
}

function issueRow(issue) {
  return `
    <div class="issue">
      <span>${esc(issue.title)}</span>
      <span>
        <em class="pill ${issue.severity === "blocker" ? "blocker" : ""}">${esc(issue.severity)}</em>
        <button type="button" class="btn small ghost" data-action="close-issue" data-id="${issue.id}">Close</button>
      </span>
    </div>`;
}

function fleet() {
  return `
    <div class="page-head">
      <div>
        <h2>Fleet 设备</h2>
        <p class="lede">设备名单里的每一台都会出现在这里。中文名称跟设备表一致，包括 A 点到 D 点的飞船。</p>
      </div>
    </div>
    <div class="fleet">
      ${state.robots.map((robot) => {
        const names = robotNames(robot);
        const device = deviceById(robot.id);
        const delivery = device ? deliveryOf(device.delivery) : null;
        return `
        <button type="button" class="robot" data-action="open-robot" data-id="${robot.id}">
          <div class="robot-top">
            <div>
              <h3>${esc(names.title)}</h3>
              <div class="local">${esc(names.zh ? names.en : robot.localName)}${robot.model ? ` · ${esc(robot.model)}` : ""}</div>
            </div>
            <span>
              ${delivery ? `<em class="pill ${delivery.pill}">${esc(delivery.zh)}</em>` : ""}
              <em class="pill ${statusClass(robot.status)}">${esc(robot.status)}</em>
            </span>
          </div>
          <p class="role">${esc(robot.role)}</p>
          <div class="now">${esc(robot.now)}</div>
        </button>`;
      }).join("")}
    </div>`;
}

function fleetDetail(id) {
  const robot = robotById(id);
  if (!robot) return fleet();
  const names = robotNames(robot);
  const specs = robot.specs || [];
  const abilities = robot.abilities || [];
  const limits = robot.limits || [];
  const chain = robot.chain || [];
  return `
    <button type="button" class="btn ghost drawer-back" data-action="close-robot">Back to fleet</button>
    <div class="detail-head">
      <div>
        <p class="local">${esc(robot.type)}${names.zh ? ` · ${esc(names.en)}` : robot.localName ? ` · ${esc(robot.localName)}` : ""}</p>
        <h2>${esc(names.title)}</h2>
        <p class="lede">${esc(robot.role)}${robot.nav ? ` Navigation: ${esc(robot.nav)}.` : ""}</p>
      </div>
      <div class="status-edit">
        <label class="field"><span>Status</span>
          <select data-robot="${robot.id}" data-robot-field="status">
            ${STATUSES.map((status) => `<option ${status === robot.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
    <label class="field"><span>Where it is now</span>
      <input class="now-edit" data-robot="${robot.id}" data-robot-field="now" type="text" value="${esc(robot.now)}">
    </label>
    <div class="detail-grid" style="margin-top:14px">
      <section class="card">
        <h3>Published figures</h3>
        ${specs.length ? `<table class="spec">${specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : `<p class="now">No published figures for this device.</p>`}
      </section>
      <div class="stack">
        <section class="card">
          <h3>What it can show</h3>
          ${abilities.length ? abilities.map((group) => `
            <div class="group">
              <h3>${esc(group.group)}</h3>
              <ul>${group.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
            </div>`).join("") : `<p class="now">Add the show notes on the device when you know them.</p>`}
        </section>
        ${limits.length ? `<section class="card">
          <h3>Keep the show inside this</h3>
          <ul class="limits">${limits.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </section>` : ""}
        ${chain.length ? `<section class="card">
          <h3>Planned sequence</h3>
          <ol class="chain">${chain.map((beat) => `
            <li><b>${esc(beat.action)}</b><span>${esc(beat.point)}</span><span>${esc(beat.detail)}</span></li>`).join("")}</ol>
        </section>` : ""}
      </div>
    </div>`;
}

function script() {
  const steps = visibleSteps();
  const timed = withTimes(steps);
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  return `
    <div class="page-head">
      <div>
        <h2>Run sheet</h2>
        <p class="lede">${state.scriptFilter === "core" ? "Core show" : state.scriptFilter === "optional" ? "Optional beats" : "Full show"} · ${total} minutes from ${esc(state.startTime)}. Edits here update the schedule and the presenter.</p>
      </div>
      <div class="filters">
        ${filterButtons()}
        <button type="button" class="btn primary" data-action="present">Presenter</button>
        <button type="button" class="btn" data-action="print">Print</button>
      </div>
    </div>
    <div class="script-list">
      ${timed.map(({ step, start }) => stepEditor(step, start)).join("")}
    </div>
    <form class="card step-edit" data-form="step">
      <h3>Add a beat 增加环节</h3>
      <input name="title" type="text" placeholder="English title">
      <input name="titleZh" type="text" placeholder="中文标题">
      <div class="step-meta">
        <label>Minutes 分钟<input name="minutes" type="number" min="1" value="3"></label>
        <label>Tier 类型<select name="tier"><option value="core">Core 核心</option><option value="optional">Optional 可选</option></select></label>
        <label>Zone 区域<select name="zone">${state.zones.map((zone) => `<option value="${zone.id}">${esc(zoneLabel(zone))}</option>`).join("")}</select></label>
      </div>
      <input name="audience" type="text" placeholder="What the visitors see 观众看到什么">
      <textarea name="cues" placeholder="Operator cues, one per line 操作提示，每行一条"></textarea>
      <div class="robot-picks">${state.robots.map((robot) => `<label><input type="checkbox" name="robots" value="${robot.id}"> ${esc(robotNames(robot).title)}</label>`).join("")}</div>
      <button class="btn primary" type="submit">Add beat</button>
    </form>`;
}

function stepEditor(step, start) {
  return `
    <article class="step ${step.status}" data-step="${step.id}">
      <time>${fmtMinutes(start)}<br>${esc(step.minutes)} min</time>
      <div class="step-edit">
        <input data-step-field="titleZh" data-id="${step.id}" type="text" value="${esc(step.titleZh || "")}" placeholder="中文标题" aria-label="Chinese title">
        <input data-step-field="title" data-id="${step.id}" type="text" value="${esc(step.title)}" placeholder="English title" aria-label="English title">
        <input data-step-field="audience" data-id="${step.id}" type="text" value="${esc(step.audience)}" placeholder="What the visitors see" aria-label="Audience line">
        <div class="step-meta">
          <label>Minutes 分钟<input data-step-field="minutes" data-id="${step.id}" type="number" min="1" value="${esc(step.minutes)}"></label>
          <label>Tier 类型<select data-step-field="tier" data-id="${step.id}">
            <option value="core" ${step.tier === "core" ? "selected" : ""}>Core 核心</option>
            <option value="optional" ${step.tier === "optional" ? "selected" : ""}>Optional 可选</option>
          </select></label>
          <label>Zone 区域<select data-step-field="zone" data-id="${step.id}">
            ${state.zones.map((zone) => `<option value="${zone.id}" ${zone.id === step.zone ? "selected" : ""}>${esc(zoneLabel(zone))}</option>`).join("")}
          </select></label>
          <label class="check"><input data-step-field="showCount" data-id="${step.id}" type="checkbox" ${step.showCount ? "checked" : ""}> Stock table 盘点表</label>
        </div>
        <div class="robot-picks">
          ${state.robots.map((robot) => `
            <label><input data-step-robot="${step.id}" type="checkbox" value="${robot.id}" ${(step.robots || []).includes(robot.id) ? "checked" : ""}> ${esc(robotNames(robot).title)}</label>`).join("")}
        </div>
        <textarea data-step-field="cues" data-id="${step.id}" aria-label="Operator cues">${esc((step.cues || []).join("\n"))}</textarea>
        <textarea class="note" data-note="${step.id}" placeholder="Operator note 现场备注">${esc(step.note || "")}</textarea>
      </div>
      <div class="step-actions">
        <button type="button" class="btn small primary" data-action="live" data-id="${step.id}">Go live</button>
        <button type="button" class="btn small" data-action="done" data-id="${step.id}">Done</button>
        <button type="button" class="btn small ghost" data-action="reset-step" data-id="${step.id}">Reset</button>
        <button type="button" class="btn small ghost" data-action="step-move" data-id="${step.id}" data-dir="-1">Up</button>
        <button type="button" class="btn small ghost" data-action="step-move" data-id="${step.id}" data-dir="1">Down</button>
        <button type="button" class="btn small ghost" data-action="step-remove" data-id="${step.id}">Remove</button>
      </div>
    </article>`;
}

function filterButtons() {
  return ["core", "all", "optional"].map((filter) => `
    <button type="button" class="btn ${state.scriptFilter === filter ? "primary" : ""}" data-action="filter" data-filter="${filter}">
      ${filter === "all" ? "Full show" : filter === "core" ? "Core" : "Optional"}
    </button>`).join("");
}

function countTable() {
  return `
    <div class="table-wrap">
      <table class="counts">
        <thead><tr><th>Location</th><th>SKU</th><th>Batch</th><th>Book</th><th>Scan</th><th></th></tr></thead>
        <tbody>
          ${state.counts.map((row, index) => {
            const gap = Number(row.actual) - Number(row.expected);
            const klass = row.actual === "" || row.actual === null ? "" : gap === 0 ? "match" : Number(row.actual) === 0 ? "empty" : "short";
            const label = row.actual === "" || row.actual === null ? "" : gap === 0 ? "Match" : Number(row.actual) === 0 ? "Empty" : `${gap > 0 ? "+" : ""}${gap}`;
            return `<tr>
              <td>${esc(row.location)}</td><td>${esc(row.sku)}</td><td>${esc(row.batch)}</td>
              <td><input data-count="${index}" data-count-field="expected" type="number" value="${esc(row.expected)}"></td>
              <td><input data-count="${index}" data-count-field="actual" type="number" value="${esc(row.actual)}"></td>
              <td class="${klass}">${esc(label)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <p class="now">Sample book stock for the warehouse stock take. Type the live scan over it.</p>
    </div>`;
}

function statusView() {
  const setup = setupSummary();
  const people = state.ownerFilter === "all" ? state.tasks : state.tasks.filter((task) => task.owner === state.ownerFilter);
  const groups = [
    ...state.phases.map((phase) => ({ id: phase.id, name: phase.name, gate: phase.id !== "show" && phase.id !== "close" })),
  ];
  return `
    <div class="page-head">
      <div>
        <h2>Project status</h2>
        <p class="lede">彩排准备须在 11 月 11 日前完成。Setup finishes before 11 Nov 2026. ${setup.done} of ${setup.total} setup tasks are done${setup.left > 0 ? `, with ${setup.left} days left` : ""}.</p>
      </div>
    </div>
    <div class="manage">
      ${manageList("assignees", "Assignees 负责人", "Name", "Role 角色")}
    </div>
    ${deviceBoard()}
    <section class="stats">
      <article class="stat"><i>Setup done</i><b>${setup.done}/${setup.total}</b><span>before 11 Nov</span></article>
      <article class="stat"><i>Late</i><b>${setup.overdue}</b><span>past the target finish</span></article>
      <article class="stat"><i>Due soon</i><b>${setup.soon}</b><span>within the next 3 days</span></article>
      <article class="stat"><i>Deadline</i><b>${setup.left}</b><span>days until 11 Nov</span></article>
    </section>
    <div class="filters">
      <select data-action="owner">
        <option value="all" ${state.ownerFilter === "all" ? "selected" : ""}>All assignees</option>
        ${(state.assignees || []).map((person) => `<option value="${esc(person.id)}" ${state.ownerFilter === person.id ? "selected" : ""}>${esc(personLabel(person))}</option>`).join("")}
      </select>
    </div>
    <div class="table-wrap card">
      <table class="status-table">
        <thead><tr><th>Task 任务</th><th>Assignee 负责人</th><th>Device 设备</th><th>Target finish 完成日</th><th>Status 状态</th></tr></thead>
        <tbody>
          ${groups.map((group) => {
            const rows = people.filter((task) => task.phase === group.id).slice().sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
            if (!rows.length) return "";
            return `<tr class="group-row"><td colspan="5">${esc(group.name)}${group.gate ? "" : " · after rehearsal"}</td></tr>` + rows.map(statusRow).join("");
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function statusRow(task) {
  const timing = taskTiming(task);
  return `
    <tr class="${timing}">
      <td>
        <div class="title-edit">
          ${task.priority === "high" ? `<em class="pill">High</em>` : ""}
          <input data-task-field="title" data-id="${task.id}" type="text" value="${esc(task.title)}" aria-label="English task">
          <input data-task-field="titleZh" data-id="${task.id}" type="text" value="${esc(task.titleZh || "")}" aria-label="Chinese task" placeholder="中文任务">
        </div>
      </td>
      <td><select data-task-field="owner" data-id="${task.id}">${assigneeOptions(task.owner)}</select></td>
      <td><select data-task-field="robotId" data-id="${task.id}">${deviceOptions(task.robotId)}</select></td>
      <td><input data-task-field="due" data-id="${task.id}" type="date" value="${esc(task.due)}"></td>
      <td><select data-task-field="column" data-id="${task.id}">${COLUMNS.map((column) => `<option value="${column.id}" ${column.id === task.column ? "selected" : ""}>${column.name}</option>`).join("")}</select></td>
    </tr>`;
}

function deviceArrival() {
  const devices = state.devices || [];
  return {
    total: devices.length,
    arrived: devices.filter((device) => ARRIVED.has(device.delivery)).length,
    held: devices.filter((device) => device.delivery === "hold").length,
  };
}

function deviceBoard() {
  const summary = deviceArrival();
  return `
    <section class="card device-board">
      <h3>Devices 设备到货</h3>
      <p class="now">${summary.arrived} of ${summary.total} delivered, on site, or ready${summary.held ? ` · ${summary.held} on hold` : ""}. Target arrival is before the 10 Nov rehearsal setup.</p>
      <div class="table-wrap">
        <table class="status-table">
          <thead><tr><th>Device 设备</th><th>中文名称</th><th>Type 类型</th><th>Delivery 到货状态</th><th>ETA 预计到达</th><th>Where 当前位置</th><th>Note 备注</th><th></th></tr></thead>
          <tbody>
            ${(state.devices || []).map((device) => `
              <tr class="${device.delivery === "hold" ? "overdue" : ARRIVED.has(device.delivery) ? "done" : ""}">
                <td><input data-list="devices" data-list-field="name" data-id="${esc(device.id)}" type="text" value="${esc(device.name)}"></td>
                <td><input data-list="devices" data-list-field="nameZh" data-id="${esc(device.id)}" type="text" value="${esc(device.nameZh || "")}"></td>
                <td><select data-list="devices" data-list-field="type" data-id="${esc(device.id)}">${DEVICE_TYPES.map((type) => `<option ${type === device.type ? "selected" : ""}>${esc(type)}</option>`).join("")}</select></td>
                <td><select data-list="devices" data-list-field="delivery" data-id="${esc(device.id)}">${DELIVERIES.map((item) => `<option value="${item.id}" ${item.id === device.delivery ? "selected" : ""}>${esc(item.zh)} · ${esc(item.en)}</option>`).join("")}</select></td>
                <td><input data-list="devices" data-list-field="eta" data-id="${esc(device.id)}" type="date" value="${esc(device.eta || "")}"></td>
                <td><input data-list="devices" data-list-field="place" data-id="${esc(device.id)}" type="text" value="${esc(device.place || "")}" placeholder="仓库 / 在途"></td>
                <td><input data-list="devices" data-list-field="note" data-id="${esc(device.id)}" type="text" value="${esc(device.note || "")}" placeholder="运单或异常"></td>
                <td><button type="button" class="btn small ghost" data-action="remove-list" data-list="devices" data-id="${esc(device.id)}">Remove</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <form class="row-form" data-form="devices">
        <input class="grow" name="name" placeholder="Device" required>
        <input class="grow" name="nameZh" placeholder="中文名称" required>
        <select name="type" aria-label="Type">${DEVICE_TYPES.map((type) => `<option>${esc(type)}</option>`).join("")}</select>
        <select name="delivery">${DELIVERIES.map((item) => `<option value="${item.id}">${esc(item.zh)} · ${esc(item.en)}</option>`).join("")}</select>
        <input name="eta" type="date" value="2026-11-06" aria-label="ETA">
        <input class="grow" name="place" placeholder="当前位置">
        <button class="btn" type="submit">Add</button>
      </form>
    </section>`;
}

function manageList(key, heading, namePlaceholder, zhPlaceholder) {
  const items = state[key] || [];
  return `
    <section class="card">
      <h3>${esc(heading)}</h3>
      ${items.map((item) => `
        <div class="manage-row">
          <input data-list="${key}" data-list-field="name" data-id="${esc(item.id)}" type="text" value="${esc(item.name)}" aria-label="${esc(namePlaceholder)}">
          <input data-list="${key}" data-list-field="nameZh" data-id="${esc(item.id)}" type="text" value="${esc(item.nameZh || "")}" aria-label="${esc(zhPlaceholder)}">
          <button type="button" class="btn small ghost" data-action="remove-list" data-list="${key}" data-id="${esc(item.id)}">Remove</button>
        </div>`).join("")}
      <form class="row-form" data-form="${key}">
        <input class="grow" name="name" placeholder="${esc(namePlaceholder)}" required>
        <input class="grow" name="nameZh" placeholder="${esc(zhPlaceholder)}" required>
        <button class="btn" type="submit">Add</button>
      </form>
    </section>`;
}

function board() {
  const tasks = state.tasks.filter((task) => state.phaseFilter === "all" || task.phase === state.phaseFilter);
  return `
    <div class="page-head">
      <div>
        <h2>Board</h2>
        <p class="lede">Move work across the board. Assignee and target finish are edited on Status.</p>
      </div>
    </div>
    <form class="row-form" data-form="task">
      <input class="grow" name="title" placeholder="New task" required>
      <input class="grow" name="titleZh" placeholder="中文任务" required>
      <select name="phase">${state.phases.map((phase) => `<option value="${phase.id}">${esc(phase.name)}</option>`).join("")}</select>
      <select name="owner">${assigneeOptions((state.assignees[0] || {}).id)}</select>
      <input name="due" type="date" value="2026-11-10" aria-label="Target finish">
      <select name="robotId">${deviceOptions("")}</select>
      <select name="priority"><option value="normal">Normal</option><option value="high">High</option></select>
      <button class="btn primary" type="submit">Add</button>
    </form>
    <div class="filters">
      <select data-action="phase">
        <option value="all">All phases</option>
        ${state.phases.map((phase) => `<option value="${phase.id}" ${state.phaseFilter === phase.id ? "selected" : ""}>${esc(phase.name)}</option>`).join("")}
      </select>
    </div>
    <div class="board">
      ${COLUMNS.map((column) => `
        <section class="column" data-column="${column.id}">
          <h3>${column.name} <em class="pill muted">${tasks.filter((task) => task.column === column.id).length}</em></h3>
          ${tasks.filter((task) => task.column === column.id).map(taskCard).join("")}
        </section>`).join("")}
    </div>`;
}

function taskCard(task) {
  const device = deviceById(task.robotId);
  const robot = robotById(task.robotId);
  return `
    <article class="task" draggable="true" data-task="${task.id}">
      <p>${esc(task.titleZh || task.title)}</p>
      <p class="now">${esc(task.title)}</p>
      <div class="sub">
        ${task.priority === "high" ? `<em class="pill">High</em>` : ""}
        <span>${esc(phaseName(task.phase))}</span>
        <span>${esc(personLabel(assigneeById(task.owner)) || task.owner)}</span>
        <span class="due ${taskTiming(task)}">${esc(fmtDate(task.due))}</span>
        ${device ? `<em class="pill ${typeClass(robot?.type)}">${esc(device.nameZh || device.name)}</em>` : ""}
      </div>
      <div class="task-actions">
        <button type="button" class="btn small ghost" data-action="task-move" data-id="${task.id}" data-dir="-1" aria-label="Move back">←</button>
        <button type="button" class="btn small ghost" data-action="task-move" data-id="${task.id}" data-dir="1" aria-label="Move forward">→</button>
        <button type="button" class="btn small ghost" data-action="task-remove" data-id="${task.id}">Remove</button>
      </div>
    </article>`;
}

function schedule() {
  const steps = visibleSteps();
  const timed = withTimes(steps);
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  const max = Math.max(...steps.map((step) => step.minutes), 1);
  return `
    <div class="page-head">
      <div>
        <h2>Schedule</h2>
        <p class="lede">${esc(state.demoDate)} · doors at ${esc(state.startTime)} · ${total} minutes on the ${state.scriptFilter === "all" ? "full" : state.scriptFilter} sheet.</p>
      </div>
      <div class="filters">${filterButtons()}</div>
    </div>
    <div class="timeline">
      ${timed.map(({ step, start, end }) => `
        <article class="slot ${step.status}">
          <div class="when">${fmtMinutes(start)}<br>${fmtMinutes(end)}</div>
          <div class="rail"><div class="dot"></div></div>
          <div class="body">
            <strong>${esc(step.titleZh || step.title)}</strong>
            ${step.titleZh ? `<p class="now">${esc(step.title)}</p>` : ""}
            <div class="chips">
              <em class="pill muted">${step.minutes} min</em>
              ${step.robots.map((id) => `<em class="pill ${typeClass(robotById(id)?.type)}">${esc(robotNames(robotById(id)).title || id)}</em>`).join("")}
            </div>
            <div class="bar"><span style="width:${Math.round((step.minutes / max) * 100)}%"></span></div>
          </div>
        </article>`).join("")}
    </div>`;
}

function presenter() {
  const list = visibleSteps();
  const unfinished = list.filter((step) => step.status !== "done");
  if (!list.length) {
    return `<div class="present"><p class="done-banner">No beats in this filter.</p><button class="btn" data-action="close-present">Close</button></div>`;
  }
  if (!unfinished.length && !state.liveStepId) {
    return `<div class="present"><p class="kicker">${esc(state.site)}</p><h2>Show complete</h2><p class="audience">Park the fleet, write down any fault, and take questions.</p><button class="btn primary" data-action="close-present">Back to the desk</button></div>`;
  }
  const current = (state.liveStepId && list.find((step) => step.id === state.liveStepId)) || unfinished[0];
  if (!current) {
    return `<div class="present"><p class="kicker">${esc(state.site)}</p><h2>Show complete</h2><button class="btn primary" data-action="close-present">Back to the desk</button></div>`;
  }
  const index = list.findIndex((step) => step.id === current.id);
  const zone = state.zones.find((item) => item.id === current.zone);
  return `
    <div class="present">
      <header>
        <div class="kicker">${esc(state.site)} · ${index + 1} of ${list.length} · ${esc(current.tier)}</div>
        <div class="clock" data-clock>${elapsed()}</div>
        <button type="button" class="btn" data-action="close-present">Close</button>
      </header>
      <div style="flex:1">
        <h2>${esc(current.titleZh || current.title)}</h2>
        ${current.titleZh ? `<p class="now">${esc(current.title)}</p>` : ""}
        <p class="audience">${esc(current.audience)}</p>
        <ol>${current.cues.map((cue) => `<li>${esc(cue)}</li>`).join("")}</ol>
        ${current.showCount ? countTable() : ""}
      </div>
      <footer>
        <div class="chips">
          <em class="pill">${esc(zone ? zoneLabel(zone) : current.zone)}</em>
          ${current.robots.map((id) => `<em class="pill ${typeClass(robotById(id)?.type)}">${esc(robotNames(robotById(id)).title || id)}</em>`).join("")}
          <span class="now">${current.minutes} min planned</span>
        </div>
        <div class="filters">
          <button type="button" class="btn" data-action="present-prev" data-id="${current.id}" ${index === 0 ? "disabled" : ""}>Previous</button>
          <button type="button" class="btn primary" data-action="present-next" data-id="${current.id}">Done, next</button>
        </div>
      </footer>
    </div>`;
}

function printSheet() {
  const timed = withTimes(state.steps.filter((step) => step.tier === "core"));
  return `
    <section class="print-only">
      <h2>OTCA · Bangkok KEC · ${esc(state.demoDate)} ${esc(state.startTime)}</h2>
      <p>${esc(state.audience)}</p>
      <ol>${timed.map(({ step, start }) => `<li>${fmtMinutes(start)} ${esc(step.titleZh || step.title)}${step.titleZh ? ` / ${esc(step.title)}` : ""} (${step.minutes} min) — ${esc(step.audience)}</li>`).join("")}</ol>
    </section>`;
}

function moveStep(id, dir) {
  const index = state.steps.findIndex((step) => step.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= state.steps.length) return;
  const [step] = state.steps.splice(index, 1);
  state.steps.splice(next, 0, step);
}

function moveTask(id, dir) {
  const task = state.tasks.find((item) => item.id === id);
  const index = COLUMNS.findIndex((column) => column.id === task.column);
  const next = COLUMNS[index + dir];
  if (next) task.column = next.id;
}

app.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el || el.matches("input, select, textarea")) return;
  const { action, id, view: nextView } = el.dataset;
  if (action === "view") mutate(() => { state.view = nextView; state.drawer = null; state.presenter = false; });
  else if (action === "present") mutate(() => { state.presenter = true; if (!state.liveStepId) {
    const first = visibleSteps().find((step) => step.status !== "done");
    if (first) goLive(first.id);
  } });
  else if (action === "close-present") mutate(() => { state.presenter = false; state.view = "script"; });
  else if (action === "filter") mutate(() => { state.scriptFilter = el.dataset.filter; });
  else if (action === "live") mutate(() => goLive(id));
  else if (action === "done") mutate(() => completeStep(id, false));
  else if (action === "reset-step") mutate(() => {
    const step = stepById(id);
    step.status = "pending";
    if (state.liveStepId === id) state.liveStepId = null;
  });
  else if (action === "present-next") mutate(() => completeStep(id, true));
  else if (action === "present-prev") mutate(() => {
    const list = visibleSteps();
    const index = list.findIndex((step) => step.id === id);
    if (list[index - 1]) goLive(list[index - 1].id);
  });
  else if (action === "check") return;
  else if (action === "close-issue") mutate(() => {
    const issue = state.issues.find((item) => item.id === id);
    issue.open = false;
    log(`Closed issue: ${issue.title}`);
  });
  else if (action === "open-robot") mutate(() => { state.drawer = id; });
  else if (action === "close-robot") mutate(() => { state.drawer = null; });
  else if (action === "task-move") mutate(() => moveTask(id, Number(el.dataset.dir)));
  else if (action === "step-move") mutate(() => moveStep(id, Number(el.dataset.dir)));
  else if (action === "step-remove") mutate(() => {
    state.steps = state.steps.filter((step) => step.id !== id);
    if (state.liveStepId === id) state.liveStepId = null;
  });
  else if (action === "task-remove") mutate(() => { state.tasks = state.tasks.filter((task) => task.id !== id); });
  else if (action === "remove-list") mutate(() => {
    const key = el.dataset.list;
    if ((state[key] || []).length <= 1) return;
    state[key] = state[key].filter((item) => item.id !== id);
    if (key === "assignees") {
      const fallback = state.assignees[0].id;
      state.tasks.forEach((task) => { if (task.owner === id) task.owner = fallback; });
      if (state.ownerFilter === id) state.ownerFilter = "all";
    } else {
      state.tasks.forEach((task) => { if (task.robotId === id) task.robotId = ""; });
      state.robots = state.robots.filter((robot) => robot.id !== id);
      state.steps.forEach((step) => {
        step.robots = (step.robots || []).filter((robotId) => robotId !== id);
        if (step.places) delete step.places[id];
      });
      if (state.drawer === id) state.drawer = null;
    }
  });
  else if (action === "print") window.print();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-meta]")) {
    mutate(() => { state[target.dataset.meta] = target.value; });
  } else if (target.matches("[data-action='check']")) {
    mutate(() => {
      const item = state.checks.find((check) => check.id === target.dataset.id);
      item.done = target.checked;
    });
  } else if (target.matches("[data-action='phase']")) {
    mutate(() => { state.phaseFilter = target.value; });
  } else if (target.matches("[data-action='owner']")) {
    mutate(() => { state.ownerFilter = target.value; });
  } else if (target.matches("[data-task-field]")) {
    mutate(() => {
      const task = state.tasks.find((item) => item.id === target.dataset.id);
      task[target.dataset.taskField] = target.value;
    });
  } else if (target.matches("[data-list]")) {
    mutate(() => {
      const item = (state[target.dataset.list] || []).find((entry) => entry.id === target.dataset.id);
      if (item) item[target.dataset.listField] = target.value;
      if (item && target.dataset.list === "devices") {
        const robot = robotById(item.id);
        if (robot) {
          if (item.name) robot.callSign = item.name;
          if (item.type) robot.type = item.type;
          if (robot.custom) {
            robot.localName = item.nameZh || "";
            robot.short = markFrom(item.nameZh || item.name);
            robot.home = homeFor(item.type);
            if (item.place) robot.now = item.place;
            if (item.note) robot.role = item.note;
          }
        }
      }
    });
  } else if (target.matches("[data-step-field]")) {
    mutate(() => {
      const step = stepById(target.dataset.id);
      const field = target.dataset.stepField;
      if (field === "minutes") step.minutes = Math.max(1, Number(target.value) || 1);
      else if (field === "cues") step.cues = target.value.split("\n").map((line) => line.trim()).filter(Boolean);
      else if (field === "showCount") step.showCount = target.checked;
      else step[field] = target.value;
      if (field === "zone") step.places = null;
    });
  } else if (target.matches("[data-step-robot]")) {
    mutate(() => {
      const step = stepById(target.dataset.stepRobot);
      const robotId = target.value;
      const robots = new Set(step.robots || []);
      if (target.checked) robots.add(robotId);
      else robots.delete(robotId);
      step.robots = [...robots];
      step.places = null;
    });
  } else if (target.matches("[data-note]")) {
    mutate(() => { stepById(target.dataset.note).note = target.value; });
  } else if (target.matches("[data-robot]")) {
    mutate(() => {
      const robot = robotById(target.dataset.robot);
      const field = target.dataset.robotField;
      robot[field] = target.value;
    });
  } else if (target.matches("[data-count]")) {
    mutate(() => {
      const row = state.counts[Number(target.dataset.count)];
      row[target.dataset.countField] = target.value === "" ? "" : Number(target.value);
    });
  }
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "gate") {
    const password = String(new FormData(form).get("password") || "");
    if (sha256(password) !== GATE_HASH) {
      showGate("That password is not right.");
      return;
    }
    sessionStorage.setItem(GATE_KEY, "1");
    render();
    return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === "issue") {
    mutate(() => {
      state.issues.unshift({ id: `i${Date.now()}`, title: data.title.trim(), severity: data.severity, open: true });
      log(`Issue: ${data.title.trim()}`);
    });
  } else if (form.dataset.form === "task") {
    mutate(() => {
      state.tasks.unshift({
        id: `t${Date.now()}`,
        title: data.title.trim(),
        titleZh: (data.titleZh || "").trim(),
        phase: data.phase,
        column: "backlog",
        owner: data.owner,
        robotId: data.robotId,
        priority: data.priority,
        due: data.due || "",
        gate: ["site", "map", "rehearsal"].includes(data.phase),
      });
    });
  } else if (form.dataset.form === "step") {
    const formData = new FormData(form);
    const titleZh = (data.titleZh || "").trim();
    const title = (data.title || "").trim() || titleZh;
    if (!title) return;
    mutate(() => {
      const id = `s${Date.now()}`;
      const tier = data.tier || "core";
      if (state.scriptFilter !== "all" && state.scriptFilter !== tier) state.scriptFilter = "all";
      state.steps.push({
        id,
        tier,
        minutes: Math.max(1, Number(data.minutes) || 3),
        title,
        titleZh,
        zone: data.zone || state.zones[0].id,
        robots: formData.getAll("robots"),
        status: "pending",
        note: "",
        audience: (data.audience || "").trim(),
        cues: (data.cues || "").split("\n").map((line) => line.trim()).filter(Boolean),
        showCount: false,
      });
      state.revealId = id;
    });
  } else if (form.dataset.form === "assignees" || form.dataset.form === "devices") {
    const key = form.dataset.form;
    mutate(() => {
      const item = {
        id: `${key === "assignees" ? "person" : "dev"}-${Date.now()}`,
        name: data.name.trim(),
        nameZh: data.nameZh.trim(),
      };
      if (key === "devices") {
        item.type = data.type || "Other";
        Object.assign(item, withDelivery({
          delivery: data.delivery || "planned",
          eta: data.eta || "",
          place: (data.place || "").trim(),
          note: "",
        }));
        state.robots.push(blankRobot(item));
      }
      state[key].push(item);
    });
  }
});

app.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-task]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.task);
  event.dataTransfer.effectAllowed = "move";
});

app.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-column]");
  if (!column) return;
  event.preventDefault();
  document.querySelectorAll(".column").forEach((item) => item.classList.toggle("over", item === column));
});

app.addEventListener("dragend", () => {
  document.querySelectorAll(".column").forEach((item) => item.classList.remove("over"));
});

app.addEventListener("drop", (event) => {
  const column = event.target.closest("[data-column]");
  if (!column) return;
  event.preventDefault();
  const id = event.dataTransfer.getData("text/plain");
  mutate(() => {
    const task = state.tasks.find((item) => item.id === id);
    if (task) task.column = column.dataset.column;
  });
});

window.addEventListener("hashchange", () => {
  const hash = location.hash.replace("#", "");
  if (hash === "present") {
    if (!state.presenter) mutate(() => { state.presenter = true; });
    return;
  }
  if (["dashboard", "status", "fleet", "script", "board", "schedule"].includes(hash) && (state.view !== hash || state.presenter)) {
    mutate(() => { state.view = hash; state.presenter = false; state.drawer = null; });
  }
});

setInterval(() => {
  const clock = document.querySelector("[data-clock]");
  if (clock) clock.textContent = elapsed();
}, 1000);

const opening = location.hash.replace("#", "");
if (opening === "present") {
  state.presenter = true;
  const first = visibleSteps().find((step) => step.status !== "done");
  if (first && state.liveStepId !== first.id) goLive(first.id);
} else if (["status", "fleet", "script", "board", "schedule"].includes(opening)) {
  state.view = opening;
}
render();
