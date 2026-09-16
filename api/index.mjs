// server/vercel-api.ts
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@libsql/client/web";
import { z as z2 } from "zod";

// lib/actions.ts
import { z } from "zod";

// lib/domain.ts
var blankState = () => ({
  employees: [],
  unavailable: [],
  days: [],
  rules: [],
  published: [],
  audit: []
});
var pairKey = (a, b) => [a, b].sort().join("|");
var weekday = (date2) => (/* @__PURE__ */ new Date(date2 + "T12:00:00Z")).getUTCDay();
function weekKey(date2) {
  const value = /* @__PURE__ */ new Date(date2 + "T12:00:00Z");
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}
function dates(month) {
  const [y, m] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(y, m, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`
  );
}
function available(s, e, date2) {
  return e.status === "ativo" && e.participates && e.start <= date2 && e.weekdays.includes(weekday(date2)) && !s.unavailable.some(
    (u) => u.employee === e.id && u.from <= date2 && u.to >= date2
  ) && !s.days.find((d) => d.date === date2)?.absent.includes(e.id);
}
var works = (d) => !["feriado", "sem SIMAS"].includes(d.kind) && d.status !== "cancelado";
function canPair(s, a, b) {
  return a !== b && !s.rules.some(
    (r) => pairKey(r.a, r.b) === pairKey(a, b) && r.rule === "bloqueada"
  );
}
var distance = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
function conflicts(s) {
  return s.days.filter(works).flatMap(
    (d) => d.assigned.filter((id) => {
      const e = s.employees.find((x) => x.id === id);
      return !e || !available(s, e, d.date);
    }).map((id) => ({ date: d.date, employee: id }))
  );
}
function makeDay(date2) {
  return {
    date: date2,
    planned: [],
    assigned: [],
    actual: [],
    absent: [],
    substitutions: [],
    status: "incompleto",
    kind: weekday(date2) === 0 || weekday(date2) === 6 ? "sem SIMAS" : "dia normal"
  };
}
function generate(input, month, today, mode = "future", from = today, rng = Math.random) {
  const base = structuredClone(input);
  for (const date2 of dates(month))
    if (!base.days.some((d) => d.date === date2)) base.days.push(makeDay(date2));
  base.days.sort((a, b) => a.date.localeCompare(b.date));
  const editable = base.days.filter(
    (d) => d.date.startsWith(month) && d.date >= today && d.status !== "confirmado" && works(d) && (mode === "day" ? d.date === from : mode === "future" ? d.date >= from : true)
  );
  const ids = new Set(editable.map((d) => d.date));
  const pool = base.employees.filter(
    (e) => e.status === "ativo" && e.participates
  );
  let best;
  let bestScore = [];
  for (let attempt = 0; attempt < 80; attempt++) {
    const s = structuredClone(base);
    for (const d of s.days)
      if (ids.has(d.date)) {
        d.assigned = [];
        d.actual = [];
        d.status = "incompleto";
      }
    const monthCounts = new Map(pool.map((e) => [e.id, 0]));
    const weekCounts = /* @__PURE__ */ new Map();
    const usedPairs = /* @__PURE__ */ new Map();
    const scheduleWeeks = new Set(
      s.days.filter((d) => d.date.startsWith(month) && works(d)).map((d) => weekKey(d.date))
    );
    for (const d of s.days) {
      if (!scheduleWeeks.has(weekKey(d.date)) || !works(d) || ids.has(d.date)) continue;
      const assigned = d.status === "confirmado" ? d.actual : d.assigned;
      if (assigned.length !== 2) continue;
      const week = weekKey(d.date);
      if (!weekCounts.has(week)) weekCounts.set(week, /* @__PURE__ */ new Map());
      if (!usedPairs.has(week)) usedPairs.set(week, /* @__PURE__ */ new Set());
      for (const id of assigned) {
        monthCounts.set(id, (monthCounts.get(id) ?? 0) + 1);
        const counts = weekCounts.get(week);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      usedPairs.get(week).add(pairKey(assigned[0], assigned[1]));
    }
    const weekTargets = /* @__PURE__ */ new Map();
    const targetTotals = new Map(monthCounts);
    for (const week of scheduleWeeks) {
      const days = s.days.filter((d) => works(d) && weekKey(d.date) === week);
      const candidates = pool.filter(
        (e) => days.some((d) => available(s, e, d.date)) && !s.unavailable.some((u) => u.employee === e.id && u.type === "f\xE9rias" && days.some((d) => u.from <= d.date && u.to >= d.date))
      );
      const targets = new Map(pool.map((e) => [e.id, 0]));
      if (days.length === 5 && candidates.length === 5) {
        candidates.forEach((e) => targets.set(e.id, 2));
      } else if (days.length === 5 && candidates.length === 4) {
        candidates.forEach((e) => targets.set(e.id, 2));
        candidates.map((e) => ({ id: e.id, count: targetTotals.get(e.id) ?? 0, random: rng() })).sort((a, b) => a.count - b.count || a.random - b.random).slice(0, 2).forEach((e) => targets.set(e.id, 3));
      } else if (candidates.length) {
        const slots = days.length * 2;
        const baseTarget = Math.floor(slots / candidates.length);
        candidates.forEach((e) => targets.set(e.id, baseTarget));
        candidates.map((e) => ({ id: e.id, count: targetTotals.get(e.id) ?? 0, random: rng() })).sort((a, b) => a.count - b.count || a.random - b.random).slice(0, slots % candidates.length).forEach((e) => targets.set(e.id, baseTarget + 1));
      }
      weekTargets.set(week, targets);
      for (const [id, target] of targets)
        targetTotals.set(id, (targetTotals.get(id) ?? 0) + target);
    }
    let penalty = 0, missing = 0;
    const todo = s.days.filter((d) => ids.has(d.date)).sort(
      (a, b) => pool.filter((e) => available(s, e, a.date)).length - pool.filter((e) => available(s, e, b.date)).length || a.date.localeCompare(b.date)
    );
    for (const d of todo) {
      const eligible = pool.filter((e) => available(s, e, d.date));
      const week = weekKey(d.date);
      const counts = weekCounts.get(week) ?? /* @__PURE__ */ new Map();
      weekCounts.set(week, counts);
      const targets = weekTargets.get(week) ?? /* @__PURE__ */ new Map();
      const pairs = usedPairs.get(week) ?? /* @__PURE__ */ new Set();
      usedPairs.set(week, pairs);
      const options = [];
      for (let i = 0; i < eligible.length; i++)
        for (let j = i + 1; j < eligible.length; j++) {
          const a = eligible[i].id, b = eligible[j].id;
          if (!canPair(s, a, b)) continue;
          if (pairs.has(pairKey(a, b))) continue;
          let balance = 0, spacing = 0, history = 0, repeat = 0;
          for (const id of [a, b]) {
            const n = counts.get(id) ?? 0, t = targets.get(id) ?? 0;
            balance += (n + 1 - t) ** 2 - (n - t) ** 2;
          }
          for (const prev of s.days) {
            if (prev.date === d.date || !works(prev)) continue;
            const p = prev.status === "confirmado" ? prev.actual : prev.assigned;
            const delta = distance(d.date, prev.date);
            for (const id of [a, b])
              if (p.includes(id) && delta < 5) spacing += 5 - delta;
            const age = (Number(month.slice(0, 4)) - Number(prev.date.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(prev.date.slice(5, 7));
            if (age >= 0 && age <= 2) {
              if (p.length === 2 && pairKey(p[0], p[1]) === pairKey(a, b))
                repeat += age === 0 ? 8 : age === 1 ? 3 : 1;
              if (age > 0)
                history += prev.actual.filter((id) => id === a || id === b).length * (age === 1 ? 2 : 1);
            }
          }
          const avoid = s.rules.some(
            (r) => pairKey(r.a, r.b) === pairKey(a, b) && r.rule === "evitar"
          ) ? 80 : 0;
          options.push({
            ids: [a, b],
            score: balance * 1e4 + repeat * 15 + avoid + spacing * 3 + history + rng() * 80
          });
        }
      options.sort((a, b) => a.score - b.score);
      const selected = options[0];
      if (selected) {
        d.assigned = selected.ids;
        d.planned = d.planned.length ? d.planned : [...selected.ids];
        d.status = base.days.find((x) => x.date === d.date)?.assigned.length ? "alterado" : "programado";
        selected.ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
        selected.ids.forEach((id) => monthCounts.set(id, (monthCounts.get(id) ?? 0) + 1));
        pairs.add(pairKey(selected.ids[0], selected.ids[1]));
        penalty += selected.score;
      } else missing++;
    }
    let imbalance = 0, squared = 0;
    for (const [week, targets] of weekTargets) {
      const counts = weekCounts.get(week) ?? /* @__PURE__ */ new Map();
      const activeTargets = [...targets.entries()].filter(([, target]) => target > 0);
      if (activeTargets.length) {
        const deviations = activeTargets.map(([id, target]) => Math.abs((counts.get(id) ?? 0) - target));
        imbalance = Math.max(imbalance, ...deviations);
        squared += activeTargets.reduce((sum, [id, target]) => sum + ((counts.get(id) ?? 0) - target) ** 2, 0);
      }
    }
    const score = [missing, imbalance, squared, penalty];
    if (!best || score.some(
      (x, i) => x < bestScore[i] && score.slice(0, i).every((v, j) => Math.abs(v - bestScore[j]) < 1e-7)
    )) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? base;
}

// lib/actions.ts
var date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
);
var employee = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  sector: z.string().max(80),
  status: z.enum(["ativo", "f\xE9rias", "afastado", "inativo"]),
  start: date,
  participates: z.boolean(),
  notes: z.string().max(1e3),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1)
});
function act(input, body2, today) {
  let s = structuredClone(input);
  const action = String(body2.action);
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(body2.month ?? today.slice(0, 7));
  const findDay = () => {
    const value = date.parse(body2.date);
    let d = s.days.find((x) => x.date === value);
    if (!d) {
      d = makeDay(value);
      s.days.push(d);
    }
    return d;
  };
  const regenerate = () => {
    for (const m of [
      ...new Set(
        s.days.filter((d) => d.date >= today).map((d) => d.date.slice(0, 7))
      )
    ])
      s = generate(s, m, today);
  };
  if (action === "employee") {
    const e = employee.parse(body2.employee);
    const old = s.employees.find((x) => x.id === e.id);
    if (old) Object.assign(old, e);
    else s.employees.push({ ...e, id: crypto.randomUUID() });
    regenerate();
  } else if (action === "unavailable") {
    const u = z.object({
      employee: z.string(),
      type: z.enum([
        "f\xE9rias",
        "folga",
        "afastamento",
        "treinamento",
        "viagem",
        "compromisso",
        "outro"
      ]),
      from: date,
      to: date
    }).parse(body2.unavailable);
    if (u.from > u.to || !s.employees.some((e) => e.id === u.employee))
      throw Error("Confira o funcion\xE1rio e as datas do per\xEDodo.");
    s.unavailable.push({ ...u, id: crypto.randomUUID() });
  } else if (action === "remove-unavailable") {
    s.unavailable = s.unavailable.filter((u) => u.id !== body2.id);
    regenerate();
  } else if (action === "generate") {
    s = generate(
      s,
      month,
      today,
      z.enum(["all", "future", "day"]).parse(body2.mode ?? "future"),
      date.parse(body2.from ?? today)
    );
  } else if (action === "fix") {
    regenerate();
  } else if (action === "publish") {
    const ds = s.days.filter((d) => d.date.startsWith(month) && works(d));
    if (!ds.length || ds.some((d) => d.assigned.length !== 2) || conflicts(s).some((c) => c.date.startsWith(month)))
      throw Error(
        "Complete as duplas e resolva os conflitos antes de publicar."
      );
    if (!s.published.includes(month)) s.published.push(month);
  } else if (action === "rule") {
    const r = z.object({
      a: z.string(),
      b: z.string(),
      rule: z.enum(["permitida", "evitar", "bloqueada"])
    }).parse(body2.rule);
    if (r.a === r.b || ![r.a, r.b].every((id) => s.employees.some((e) => e.id === id)))
      throw Error("Selecione dois funcion\xE1rios diferentes.");
    s.rules = s.rules.filter((x) => pairKey(x.a, x.b) !== pairKey(r.a, r.b));
    s.rules.push(r);
    regenerate();
  } else if (["confirm", "absence", "substitute", "kind"].includes(action)) {
    const d = findDay();
    if (action === "confirm") {
      if (d.date > today)
        throw Error(
          "A presen\xE7a s\xF3 pode ser confirmada na data ou depois dela."
        );
      if (!works(d) || d.assigned.length !== 2)
        throw Error("Complete a dupla antes de confirmar.");
      d.actual = d.assigned.filter((id) => !d.absent.includes(id));
      if (d.actual.length !== 2)
        throw Error("Escolha um substituto antes de confirmar.");
      d.status = "confirmado";
    } else if (action === "kind") {
      if (d.date < today || d.status === "confirmado")
        throw Error("Dias passados ou confirmados est\xE3o protegidos.");
      d.kind = z.enum([
        "dia normal",
        "feriado",
        "sem SIMAS",
        "evento interno",
        "cancelado"
      ]).parse(body2.kind);
      d.status = d.kind === "cancelado" ? "cancelado" : "incompleto";
      d.assigned = [];
      d.planned = [];
      d.actual = [];
      if (works(d)) s = generate(s, month, today, "day", d.date);
    } else {
      const old = z.string().parse(body2.employee);
      if (!d.assigned.includes(old))
        throw Error("Essa pessoa n\xE3o est\xE1 escalada neste dia.");
      if (d.status === "confirmado")
        throw Error("A presen\xE7a deste dia j\xE1 foi confirmada.");
      if (action === "absence") {
        if (d.date > today)
          throw Error("Use indisponibilidade para informar aus\xEAncias futuras.");
        if (!d.absent.includes(old)) d.absent.push(old);
        d.actual = d.actual.filter((x) => x !== old);
        d.status = "incompleto";
      } else {
        const id = z.string().parse(body2.replacement);
        const e = s.employees.find((x) => x.id === id);
        const other = d.assigned.find((x) => x !== old);
        if (!e || !available(s, e, d.date) || d.assigned.includes(id) || other && !canPair(s, id, other))
          throw Error(
            "Essa substitui\xE7\xE3o n\xE3o respeita a disponibilidade ou a regra da dupla."
          );
        d.assigned = d.assigned.map((x) => x === old ? id : x);
        d.substitutions.push({ from: old, to: id });
        d.status = "alterado";
        if (body2.recalculate) {
          const next = /* @__PURE__ */ new Date(d.date + "T12:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          const from = next.toISOString().slice(0, 10);
          for (const m of [
            ...new Set(
              s.days.filter((x) => x.date >= from).map((x) => x.date.slice(0, 7))
            )
          ])
            s = generate(s, m, today, "future", from);
        }
      }
    }
  } else if (action === "demo") {
    if (s.employees.length)
      throw Error("O exemplo s\xF3 pode ser carregado com o cadastro vazio.");
    s.employees = [
      "Ana Martins",
      "Bruno Costa",
      "Camila Souza",
      "Daniel Oliveira",
      "Elisa Santos",
      "Felipe Almeida",
      "Gabriela Lima",
      "Henrique Silva"
    ].map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      sector: ["Administrativo", "Atendimento", "Opera\xE7\xF5es"][i % 3],
      status: "ativo",
      start: month + "-01",
      participates: true,
      notes: "Funcion\xE1rio fict\xEDcio para demonstra\xE7\xE3o.",
      weekdays: [1, 2, 3, 4, 5]
    }));
    s = generate(s, month, month + "-01", "all");
  } else throw Error("A\xE7\xE3o n\xE3o reconhecida.");
  s.days.sort((a, b) => a.date.localeCompare(b.date));
  return s;
}

// server/vercel-api.ts
var scrypt = promisify(scryptCallback);
var url = process.env.TURSO_DATABASE_URL;
var authToken = process.env.TURSO_AUTH_TOKEN;
var setupToken = process.env.SETUP_TOKEN ?? "";
if (!url || !authToken) throw Error("Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN na Vercel.");
if (setupToken.length < 24) throw Error("Configure SETUP_TOKEN com pelo menos 24 caracteres aleat\xF3rios.");
var db = url.startsWith("file:") ? (await import("@libsql/client")).createClient({ url }) : createClient({ url, authToken });
function closeDatabaseForTests() {
  db.close();
}
var schema = [
  "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','viewer')),password_hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)"
];
var ready;
function initialize() {
  ready ??= (async () => {
    for (const sql of schema) await db.execute(sql);
    await db.execute({ sql: "INSERT OR IGNORE INTO workspace(id,data) VALUES (?,?)", args: ["simas", JSON.stringify(blankState())] });
  })().catch((e) => {
    ready = void 0;
    throw e;
  });
  return ready;
}
var fields = "id,email,name,role";
var hash = (value) => createHash("sha256").update(value).digest("hex");
var credentials = z2.object({ email: z2.string().trim().email().max(200).transform((x) => x.toLowerCase()), password: z2.string().min(12).max(128) });
var accessPassword = z2.object({ password: z2.string().min(12).max(128) });
async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
async function passwordMatches(password, stored) {
  const [salt, value] = stored.split(":");
  const computed = await scrypt(password, salt, 64);
  const expected = Buffer.from(value, "hex");
  return expected.length === computed.length && timingSafeEqual(computed, expected);
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").map((x) => {
    const i = x.indexOf("=");
    return [x.slice(0, i).trim(), x.slice(i + 1)];
  }));
}
function cookie(token, maxAge) {
  return `simas_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Secure`;
}
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
  res.end(JSON.stringify(data));
}
async function one(sql, args = []) {
  return (await db.execute({ sql, args })).rows[0];
}
async function run(sql, args = []) {
  return db.execute({ sql, args });
}
async function identity(req) {
  const token = cookies(req).simas_session;
  if (!token) return;
  return one(`SELECT ${fields.split(",").map((x) => "u." + x).join(",")} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`, [hash(token), Date.now()]);
}
async function session(res, user) {
  const token = randomBytes(32).toString("base64url");
  await run("DELETE FROM sessions WHERE expires<=?", [Date.now()]);
  await run("INSERT INTO sessions VALUES (?,?,?)", [hash(token), user.id, Date.now() + 12 * 60 * 60 * 1e3]);
  res.setHeader("Set-Cookie", cookie(token, 12 * 60 * 60));
}
async function readState() {
  return await one("SELECT revision,data FROM workspace WHERE id=?", ["simas"]);
}
async function snapshot(user) {
  const row = await readState();
  return { state: JSON.parse(row.data), revision: row.revision, user };
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256e3) throw Error("Envie menos informa\xE7\xF5es por vez.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function allowedAttempt(key) {
  await run("DELETE FROM login_limits WHERE reset_at<?", [Date.now()]);
  const row = await one("SELECT attempts FROM login_limits WHERE key=?", [key]);
  if ((row?.attempts ?? 0) >= 10) return false;
  await run("INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", [key, Date.now() + 15 * 60 * 1e3]);
  return true;
}
async function transaction(fn) {
  const tx = await db.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
var labels = { employee: "Cadastro de funcion\xE1rio atualizado", unavailable: "Indisponibilidade cadastrada", "remove-unavailable": "Indisponibilidade removida", generate: "Escala recalculada", fix: "Conflitos corrigidos", publish: "Escala publicada", rule: "Regra de dupla atualizada", confirm: "Presen\xE7as confirmadas", absence: "Falta registrada", substitute: "Funcion\xE1rio substitu\xEDdo", kind: "Tipo de dia alterado", demo: "Exemplo demonstrativo carregado" };
function stateChanges(previous, state) {
  return ["employees", "unavailable", "days", "rules", "published"].flatMap((collection) => {
    const key = (item) => {
      if (typeof item === "string") return item;
      const r = item;
      return String(r.id ?? r.date ?? [r.a, r.b].sort().join("|"));
    };
    const before = new Map(previous[collection].map((item) => [key(item), item]));
    const after = new Map(state[collection].map((item) => [key(item), item]));
    return [.../* @__PURE__ */ new Set([...before.keys(), ...after.keys()])].flatMap((id) => JSON.stringify(before.get(id)) === JSON.stringify(after.get(id)) ? [] : [{ collection, before: before.get(id) ?? null, after: after.get(id) ?? null }]);
  });
}
async function handler(req, res) {
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  try {
    await initialize();
    const origin = `https://${req.headers.host}`;
    const requestUrl = new URL(req.url ?? "/", origin);
    const route = requestUrl.searchParams.get("route");
    const path = route ? route === "healthz" ? "/healthz" : "/api/" + route : requestUrl.pathname;
    if (path === "/healthz") return json(res, 200, { status: "ok" });
    if (!path.startsWith("/api/")) return json(res, 404, { error: "P\xE1gina n\xE3o encontrada." });
    if (req.method !== "GET" && (req.headers.origin !== origin || !req.headers["content-type"]?.startsWith("application/json"))) return json(res, 403, { error: "Origem n\xE3o permitida." });
    if (path === "/api/auth/status" && req.method === "GET") return json(res, 200, { needsSetup: !await one("SELECT id FROM users LIMIT 1") });
    if (["/api/auth/login", "/api/auth/setup"].includes(path) && req.method === "POST") {
      const input = await body(req);
      const parsed = path.endsWith("/setup") ? credentials.parse(input) : accessPassword.parse(input);
      const peer = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim();
      const key = hash("ip:" + peer);
      if (!await allowedAttempt(key)) return json(res, 429, { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
      if (path.endsWith("/setup")) {
        if (hash(String(input.token ?? "")) !== hash(setupToken)) return json(res, 403, { error: "C\xF3digo de instala\xE7\xE3o inv\xE1lido." });
        const setup = credentials.parse(input);
        const name = z2.string().trim().min(2).max(100).parse(input.name);
        const password = await passwordHash(setup.password);
        const user3 = await transaction(async (tx) => {
          if ((await tx.execute("SELECT id FROM users LIMIT 1")).rows.length) throw Error("A instala\xE7\xE3o j\xE1 foi conclu\xEDda. Entre com sua conta.");
          const user4 = { id: randomUUID(), email: setup.email, name, role: "admin" };
          await tx.execute({ sql: "INSERT INTO users VALUES (?,?,?,?,?)", args: [user4.id, user4.email, user4.name, user4.role, password] });
          await tx.execute({ sql: "INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)", args: [user4.id, "Administrador inicial criado", (/* @__PURE__ */ new Date()).toISOString()] });
          return user4;
        });
        await session(res, user3);
        return json(res, 201, { ok: true });
      }
      const user2 = await one("SELECT * FROM users WHERE role='admin' LIMIT 1");
      const valid = await passwordMatches(parsed.password, user2?.password_hash ?? "00000000000000000000000000000000:" + "00".repeat(64));
      if (!user2 || !valid) return json(res, 401, { error: "Senha incorreta." });
      await run("DELETE FROM login_limits WHERE key=?", [key]);
      await session(res, user2);
      return json(res, 200, { ok: true });
    }
    const user = await identity(req);
    if (!user) return json(res, 401, { error: "Entre na sua conta para acessar o SIMAS." });
    if (path === "/api/auth/logout" && req.method === "POST") {
      await run("DELETE FROM sessions WHERE token_hash=?", [hash(cookies(req).simas_session ?? "")]);
      res.setHeader("Set-Cookie", cookie("", 0));
      return json(res, 200, { ok: true });
    }
    if (path === "/api/state" && req.method === "GET") return json(res, 200, await snapshot(user));
    if (req.method !== "POST") return json(res, 404, { error: "P\xE1gina n\xE3o encontrada." });
    if (user.role !== "admin") return json(res, 403, { error: "Somente administradores podem alterar a escala." });
    if (path === "/api/access/password") {
      const input = accessPassword.parse(await body(req));
      const pw = await passwordHash(input.password);
      await transaction(async (tx) => {
        await tx.execute({ sql: "UPDATE users SET password_hash=? WHERE id=?", args: [pw, user.id] });
        await tx.execute({ sql: "DELETE FROM sessions WHERE user_id=?", args: [user.id] });
        await tx.execute({ sql: "INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)", args: [user.id, "Senha de acesso alterada", (/* @__PURE__ */ new Date()).toISOString()] });
      });
      return json(res, 200, { ok: true });
    }
    if (path === "/api/state") {
      const input = z2.object({ action: z2.string(), revision: z2.number().int() }).passthrough().parse(await body(req));
      const row = await readState();
      if (row.revision !== input.revision) return json(res, 409, { error: "Outra pessoa alterou os dados. Atualize a p\xE1gina antes de continuar." });
      const previous = JSON.parse(row.data);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
      const state = act(previous, input, today);
      state.audit.unshift({ at: (/* @__PURE__ */ new Date()).toISOString(), actor: user.name, message: `${labels[input.action] ?? input.action}${input.date ? " \xB7 " + input.date : ""}${input.month ? " \xB7 " + input.month : ""}`, changes: stateChanges(previous, state) });
      const result = await run("UPDATE workspace SET data=?,revision=revision+1 WHERE id=? AND revision=?", [JSON.stringify(state), "simas", row.revision]);
      if (!result.rowsAffected) return json(res, 409, { error: "Os dados mudaram em outra sess\xE3o. Atualize a p\xE1gina." });
      return json(res, 200, await snapshot(user));
    }
    return json(res, 404, { error: "P\xE1gina n\xE3o encontrada." });
  } catch (e) {
    console.error(e);
    const invalid = e instanceof z2.ZodError;
    const status = invalid ? 400 : 503;
    json(res, status, { error: invalid ? "Confira os campos. Use e-mail v\xE1lido e senha com pelo menos 12 caracteres." : "N\xE3o foi poss\xEDvel concluir a opera\xE7\xE3o." });
  }
}
export {
  closeDatabaseForTests,
  handler as default
};
