export type Employee = {
  id: string;
  name: string;
  sector: string;
  status: string;
  start: string;
  participates: boolean;
  notes: string;
  weekdays: number[];
};
export type Unavailability = {
  id: string;
  employee: string;
  type: string;
  from: string;
  to: string;
};
export type Day = {
  date: string;
  planned: string[];
  assigned: string[];
  actual: string[];
  absent: string[];
  substitutions: { from: string; to: string }[];
  status: string;
  kind: string;
};
export type PairRule = { a: string; b: string; rule: string };
export type State = {
  employees: Employee[];
  unavailable: Unavailability[];
  days: Day[];
  rules: PairRule[];
  published: string[];
  audit: {
    at: string;
    actor: string;
    message: string;
    changes?: { collection: string; before: unknown; after: unknown }[];
  }[];
};
export const blankState = (): State => ({
  employees: [],
  unavailable: [],
  days: [],
  rules: [],
  published: [],
  audit: [],
});
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
export const weekday = (date: string) =>
  new Date(date + "T12:00:00Z").getUTCDay();
export function dates(month: string) {
  const [y, m] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(y, m, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
export function available(s: State, e: Employee, date: string) {
  return (
    e.status === "ativo" &&
    e.participates &&
    e.start <= date &&
    e.weekdays.includes(weekday(date)) &&
    !s.unavailable.some(
      (u) => u.employee === e.id && u.from <= date && u.to >= date,
    ) &&
    !s.days.find((d) => d.date === date)?.absent.includes(e.id)
  );
}
export const works = (d: Day) =>
  !["feriado", "sem SIMAS"].includes(d.kind) && d.status !== "cancelado";
export function canPair(s: State, a: string, b: string) {
  return (
    a !== b &&
    !s.rules.some(
      (r) => pairKey(r.a, r.b) === pairKey(a, b) && r.rule === "bloqueada",
    )
  );
}
export function summary(s: State, month: string) {
  return s.employees.map((e) => ({
    ...e,
    planned: s.days.filter(
      (d) => d.date.startsWith(month) && works(d) && d.assigned.includes(e.id),
    ).length,
    actual: s.days.filter(
      (d) => d.date.startsWith(month) && d.actual.includes(e.id),
    ).length,
    absences: s.days.filter(
      (d) => d.date.startsWith(month) && d.absent.includes(e.id),
    ).length,
    substitutions: s.days
      .filter((d) => d.date.startsWith(month))
      .reduce(
        (n, d) => n + d.substitutions.filter((x) => x.to === e.id).length,
        0,
      ),
  }));
}
export function pairHistory(s: State, actualOnly = true) {
  const map = new Map<string, { a: string; b: string; count: number }>();
  for (const d of s.days) {
    const p = actualOnly
      ? d.actual
      : d.status === "confirmado"
        ? d.actual
        : d.assigned;
    if (p.length !== 2 || !works(d)) continue;
    const key = pairKey(p[0], p[1]);
    map.set(key, { a: p[0], b: p[1], count: (map.get(key)?.count ?? 0) + 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
const distance = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
export function substitutes(s: State, d: Day, old: string) {
  const other = d.assigned.find((id) => id !== old);
  return s.employees
    .filter(
      (e) =>
        available(s, e, d.date) &&
        !d.assigned.includes(e.id) &&
        (!other || canPair(s, e.id, other)),
    )
    .map((e) => {
      const ds = s.days.filter((x) => x.date < d.date && works(x));
      const planned = s.days.filter(
        (x) =>
          x.date.startsWith(d.date.slice(0, 7)) &&
          x.assigned.includes(e.id) &&
          works(x),
      ).length;
      const last =
        ds
          .filter((x) =>
            (x.status === "confirmado" ? x.actual : x.assigned).includes(e.id),
          )
          .at(-1)?.date ?? null;
      const pairs = other
        ? (pairHistory(s).find(
            (p) => pairKey(p.a, p.b) === pairKey(e.id, other),
          )?.count ?? 0)
        : 0;
      return {
        ...e,
        planned,
        last,
        pairs,
        score:
          planned * 100 +
          pairs * 10 +
          (last ? Math.max(0, 5 - distance(d.date, last)) * 8 : 0),
      };
    })
    .sort((a, b) => a.score - b.score);
}
export function conflicts(s: State) {
  return s.days.filter(works).flatMap((d) =>
    d.assigned
      .filter((id) => {
        const e = s.employees.find((x) => x.id === id);
        return !e || !available(s, e, d.date);
      })
      .map((id) => ({ date: d.date, employee: id })),
  );
}
export function makeDay(date: string): Day {
  return {
    date,
    planned: [],
    assigned: [],
    actual: [],
    absent: [],
    substitutions: [],
    status: "incompleto",
    kind:
      weekday(date) === 0 || weekday(date) === 6 ? "sem SIMAS" : "dia normal",
  };
}
/** Pure multistart scheduler. Mandatory constraints are never softened.
 * Availability-weighted balance precedes pair/spacing/history costs.
 * rng is injectable; past and confirmed dates are immutable. */
export function generate(
  input: State,
  month: string,
  today: string,
  mode = "future",
  from = today,
  rng: () => number = Math.random,
): State {
  const base = structuredClone(input);
  for (const date of dates(month))
    if (!base.days.some((d) => d.date === date)) base.days.push(makeDay(date));
  base.days.sort((a, b) => a.date.localeCompare(b.date));
  const editable = base.days.filter(
    (d) =>
      d.date.startsWith(month) &&
      d.date >= today &&
      d.status !== "confirmado" &&
      works(d) &&
      (mode === "day"
        ? d.date === from
        : mode === "future"
          ? d.date >= from
          : true),
  );
  const ids = new Set(editable.map((d) => d.date));
  const pool = base.employees.filter(
    (e) => e.status === "ativo" && e.participates,
  );
  const availability = new Map(
    pool.map((e) => [
      e.id,
      base.days.filter(
        (d) =>
          d.date.startsWith(month) && works(d) && available(base, e, d.date),
      ).length,
    ]),
  );
  const total = [...availability.values()].reduce((a, b) => a + b, 0),
    slots =
      base.days.filter((d) => d.date.startsWith(month) && works(d)).length * 2;
  const targets = new Map(
    pool.map((e) => [
      e.id,
      total ? (slots * (availability.get(e.id) ?? 0)) / total : 0,
    ]),
  );
  let best: State | undefined;
  let bestScore: number[] = [];
  for (let attempt = 0; attempt < 80; attempt++) {
    const s = structuredClone(base);
    for (const d of s.days)
      if (ids.has(d.date)) {
        d.assigned = [];
        d.actual = [];
        d.status = "incompleto";
      }
    const counts = new Map(
      pool.map((e) => [
        e.id,
        s.days.filter(
          (d) =>
            d.date.startsWith(month) &&
            works(d) &&
            (d.status === "confirmado" ? d.actual : d.assigned).includes(e.id),
        ).length,
      ]),
    );
    let penalty = 0,
      missing = 0;
    const todo = s.days
      .filter((d) => ids.has(d.date))
      .sort(
        (a, b) =>
          pool.filter((e) => available(s, e, a.date)).length -
            pool.filter((e) => available(s, e, b.date)).length ||
          a.date.localeCompare(b.date),
      );
    for (const d of todo) {
      const eligible = pool.filter((e) => available(s, e, d.date));
      const options: { ids: string[]; score: number }[] = [];
      for (let i = 0; i < eligible.length; i++)
        for (let j = i + 1; j < eligible.length; j++) {
          const a = eligible[i].id,
            b = eligible[j].id;
          if (!canPair(s, a, b)) continue;
          let balance = 0,
            spacing = 0,
            history = 0,
            repeat = 0;
          for (const id of [a, b]) {
            const n = counts.get(id) ?? 0,
              t = targets.get(id) ?? 1;
            balance += (n + 1 - t) ** 2 - (n - t) ** 2;
          }
          for (const prev of s.days) {
            if (prev.date === d.date || !works(prev)) continue;
            const p =
              prev.status === "confirmado" ? prev.actual : prev.assigned;
            const delta = distance(d.date, prev.date);
            for (const id of [a, b])
              if (p.includes(id) && delta < 5) spacing += 5 - delta;
            const age =
              (Number(month.slice(0, 4)) - Number(prev.date.slice(0, 4))) * 12 +
              Number(month.slice(5)) -
              Number(prev.date.slice(5, 7));
            if (age >= 0 && age <= 2) {
              if (p.length === 2 && pairKey(p[0], p[1]) === pairKey(a, b))
                repeat += age === 0 ? 8 : age === 1 ? 3 : 1;
              if (age > 0)
                history +=
                  prev.actual.filter((id) => id === a || id === b).length *
                  (age === 1 ? 2 : 1);
            }
          }
          const avoid = s.rules.some(
            (r) => pairKey(r.a, r.b) === pairKey(a, b) && r.rule === "evitar",
          )
            ? 80
            : 0;
          options.push({
            ids: [a, b],
            score:
              balance * 1000 +
              repeat * 15 +
              avoid +
              spacing * 3 +
              history +
              rng() * 80,
          });
        }
      options.sort((a, b) => a.score - b.score);
      const selected = options[0];
      if (selected) {
        d.assigned = selected.ids;
        d.planned = d.planned.length ? d.planned : [...selected.ids];
        d.status = base.days.find((x) => x.date === d.date)?.assigned.length
          ? "alterado"
          : "programado";
        selected.ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
        penalty += selected.score;
      } else missing++;
    }
    const vals = pool
      .filter((e) => (availability.get(e.id) ?? 0) > 0)
      .map((e) => counts.get(e.id) ?? 0);
    const equal =
      new Set([...availability.values()].filter((v) => v > 0)).size <= 1;
    const imbalance =
      equal && vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    const squared = pool.reduce(
      (n, e) => n + ((counts.get(e.id) ?? 0) - (targets.get(e.id) ?? 0)) ** 2,
      0,
    );
    const score = [missing, imbalance, squared, penalty];
    if (
      !best ||
      score.some(
        (x, i) =>
          x < bestScore[i] &&
          score.slice(0, i).every((v, j) => Math.abs(v - bestScore[j]) < 1e-7),
      )
    ) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? base;
}
