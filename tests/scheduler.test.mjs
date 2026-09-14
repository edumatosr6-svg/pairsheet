import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(
  fs.readFileSync(new URL("../lib/domain.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const domainURL =
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const {
  blankState,
  generate,
  summary,
  available,
  canPair,
  makeDay,
  works,
  pairHistory,
} = await import(domainURL);
const actionsCode = ts
  .transpileModule(
    fs.readFileSync(new URL("../lib/actions.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replace(/from ['"]\.\/domain['"]/, `from '${domainURL}'`)
  .replace(
    /from ['"]zod['"]/,
    `from '${new URL("../node_modules/zod/index.js", import.meta.url).href}'`,
  );
const { act } = await import(
  "data:text/javascript;base64," + Buffer.from(actionsCode).toString("base64")
);
function seed(n = 8) {
  const s = blankState();
  s.employees = Array.from({ length: n }, (_, i) => ({
    id: String(i),
    name: "Pessoa " + i,
    status: "ativo",
    sector: "A",
    start: "2026-01-01",
    weekdays: [1, 2, 3, 4, 5],
    participates: true,
    notes: "",
  }));
  return s;
}
function rng() {
  let value = 42;
  return () =>
    (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296;
}
test("equal availability distributes with difference at most one", () => {
  const s = generate(
    seed(),
    "2026-10",
    "2026-10-01",
    "all",
    "2026-10-01",
    rng(),
  );
  const counts = summary(s, "2026-10").map((e) => e.planned);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(
    s.days.filter(works).filter((d) => d.assigned.length === 2).length,
    22,
  );
});
test("mandatory constraints, entry dates, recurring days and blocked pairs", () => {
  const s = seed();
  s.employees[0].start = "2026-10-15";
  s.employees[1].weekdays = [1, 2, 3];
  s.employees[2].status = "inativo";
  s.employees[3].participates = false;
  s.unavailable.push({
    id: "u",
    employee: "4",
    type: "férias",
    from: "2026-10-05",
    to: "2026-10-20",
  });
  s.rules.push({ a: "5", b: "6", rule: "bloqueada" });
  const d = makeDay("2026-10-12");
  d.kind = "feriado";
  s.days.push(d);
  const result = generate(
    s,
    "2026-10",
    "2026-10-01",
    "all",
    "2026-10-01",
    rng(),
  );
  for (const day of result.days) {
    for (const id of day.assigned)
      assert.ok(
        available(
          result,
          result.employees.find((e) => e.id === id),
          day.date,
        ),
      );
    if (day.assigned.length === 2) assert.ok(canPair(result, ...day.assigned));
  }
  assert.equal(
    result.days.find((d) => d.date === "2026-10-12").assigned.length,
    0,
  );
});
test("past and confirmed dates stay byte-for-byte unchanged", () => {
  const s = generate(
    seed(),
    "2026-10",
    "2026-10-01",
    "all",
    "2026-10-01",
    rng(),
  );
  const d = s.days.find((d) => d.date === "2026-10-20");
  d.actual = [...d.assigned];
  d.status = "confirmado";
  const before = s.days.filter(
    (d) => d.date < "2026-10-15" || d.status === "confirmado",
  );
  const after = generate(
    s,
    "2026-10",
    "2026-10-15",
    "all",
    "2026-10-15",
    rng(),
  );
  assert.deepEqual(
    after.days.filter(
      (d) => d.date < "2026-10-15" || d.status === "confirmado",
    ),
    before,
  );
});
test("impossible blocked roster reports incomplete instead of violating constraints", () => {
  const s = seed(2);
  s.rules.push({ a: "0", b: "1", rule: "bloqueada" });
  const r = generate(s, "2026-10", "2026-10-01", "all", "2026-10-01", rng());
  assert.ok(
    r.days
      .filter(works)
      .every((d) => d.assigned.length === 0 && d.status === "incompleto"),
  );
});
test("absence, replacement, future recalculation and actual history stay separate", () => {
  let s = generate(seed(), "2026-10", "2026-10-01", "all", "2026-10-01", rng());
  const date = "2026-10-01";
  const original = [...s.days.find((d) => d.date === date).assigned];
  const old = original[0];
  s = act(
    s,
    { action: "absence", date, employee: old, month: "2026-10" },
    date,
  );
  assert.equal(summary(s, "2026-10").find((e) => e.id === old).actual, 0);
  const replacement = s.employees.find((e) => !original.includes(e.id)).id;
  s = act(
    s,
    {
      action: "substitute",
      date,
      employee: old,
      replacement,
      recalculate: true,
      month: "2026-10",
    },
    date,
  );
  assert.ok(s.days.find((d) => d.date === date).assigned.includes(replacement));
  s = act(s, { action: "confirm", date, month: "2026-10" }, date);
  assert.equal(
    summary(s, "2026-10").find((e) => e.id === replacement).actual,
    1,
  );
  assert.equal(summary(s, "2026-10").find((e) => e.id === old).actual, 0);
  assert.deepEqual(s.days.find((d) => d.date === date).planned, original);
  assert.equal(pairHistory(s)[0].count, 1);
  assert.throws(() =>
    act(
      s,
      { action: "absence", date, employee: replacement, month: "2026-10" },
      date,
    ),
  );
});
test("pure input and deterministic injected random", () => {
  const s = seed(4),
    before = structuredClone(s);
  const a = generate(s, "2026-10", "2026-10-01", "all", "2026-10-01", rng());
  const b = generate(s, "2026-10", "2026-10-01", "all", "2026-10-01", rng());
  assert.deepEqual(a, b);
  assert.deepEqual(s, before);
});
