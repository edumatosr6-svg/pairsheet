import { z } from "zod";
import {
  type State,
  generate,
  available,
  canPair,
  makeDay,
  works,
  conflicts,
  pairKey,
} from "./domain";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
  );
const employee = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  sector: z.string().max(80),
  status: z.enum(["ativo", "férias", "afastado", "inativo"]),
  start: date,
  participates: z.boolean(),
  notes: z.string().max(1000),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
});
export function act(
  input: State,
  body: Record<string, unknown>,
  today: string,
): State {
  let s = structuredClone(input);
  const action = String(body.action);
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(body.month ?? today.slice(0, 7));
  const findDay = () => {
    const value = date.parse(body.date);
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
        s.days.filter((d) => d.date >= today).map((d) => d.date.slice(0, 7)),
      ),
    ])
      s = generate(s, m, today);
  };
  if (action === "employee") {
    const e = employee.parse(body.employee);
    const old = s.employees.find((x) => x.id === e.id);
    if (old) Object.assign(old, e);
    else s.employees.push({ ...e, id: crypto.randomUUID() });
    regenerate();
  } else if (action === "unavailable") {
    const u = z
      .object({
        employee: z.string(),
        type: z.enum([
          "férias",
          "folga",
          "afastamento",
          "treinamento",
          "viagem",
          "compromisso",
          "outro",
        ]),
        from: date,
        to: date,
      })
      .parse(body.unavailable);
    if (u.from > u.to || !s.employees.some((e) => e.id === u.employee))
      throw Error("Confira o funcionário e as datas do período.");
    s.unavailable.push({ ...u, id: crypto.randomUUID() });
  } else if (action === "remove-unavailable") {
    s.unavailable = s.unavailable.filter((u) => u.id !== body.id);
    regenerate();
  } else if (action === "generate") {
    s = generate(
      s,
      month,
      today,
      z.enum(["all", "future", "day"]).parse(body.mode ?? "future"),
      date.parse(body.from ?? today),
    );
  } else if (action === "fix") {
    regenerate();
  } else if (action === "publish") {
    const ds = s.days.filter((d) => d.date.startsWith(month) && works(d));
    if (
      !ds.length ||
      ds.some((d) => d.assigned.length !== 2) ||
      conflicts(s).some((c) => c.date.startsWith(month))
    )
      throw Error(
        "Complete as duplas e resolva os conflitos antes de publicar.",
      );
    if (!s.published.includes(month)) s.published.push(month);
  } else if (action === "rule") {
    const r = z
      .object({
        a: z.string(),
        b: z.string(),
        rule: z.enum(["permitida", "evitar", "bloqueada"]),
      })
      .parse(body.rule);
    if (
      r.a === r.b ||
      ![r.a, r.b].every((id) => s.employees.some((e) => e.id === id))
    )
      throw Error("Selecione dois funcionários diferentes.");
    s.rules = s.rules.filter((x) => pairKey(x.a, x.b) !== pairKey(r.a, r.b));
    s.rules.push(r);
    regenerate();
  } else if (["confirm", "absence", "substitute", "kind"].includes(action)) {
    const d = findDay();
    if (action === "confirm") {
      if (d.date > today)
        throw Error(
          "A presença só pode ser confirmada na data ou depois dela.",
        );
      if (!works(d) || d.assigned.length !== 2)
        throw Error("Complete a dupla antes de confirmar.");
      d.actual = d.assigned.filter((id) => !d.absent.includes(id));
      if (d.actual.length !== 2)
        throw Error("Escolha um substituto antes de confirmar.");
      d.status = "confirmado";
    } else if (action === "kind") {
      if (d.date < today || d.status === "confirmado")
        throw Error("Dias passados ou confirmados estão protegidos.");
      d.kind = z
        .enum([
          "dia normal",
          "feriado",
          "sem SIMAS",
          "evento interno",
          "cancelado",
        ])
        .parse(body.kind);
      d.status = d.kind === "cancelado" ? "cancelado" : "incompleto";
      d.assigned = [];
      d.planned = [];
      d.actual = [];
      if (works(d)) s = generate(s, month, today, "day", d.date);
    } else {
      const old = z.string().parse(body.employee);
      if (!d.assigned.includes(old))
        throw Error("Essa pessoa não está escalada neste dia.");
      if (d.status === "confirmado")
        throw Error("A presença deste dia já foi confirmada.");
      if (action === "absence") {
        if (d.date > today)
          throw Error("Use indisponibilidade para informar ausências futuras.");
        if (!d.absent.includes(old)) d.absent.push(old);
        d.actual = d.actual.filter((x) => x !== old);
        d.status = "incompleto";
      } else {
        const id = z.string().parse(body.replacement);
        const e = s.employees.find((x) => x.id === id);
        const other = d.assigned.find((x) => x !== old);
        if (
          !e ||
          !available(s, e, d.date) ||
          d.assigned.includes(id) ||
          (other && !canPair(s, id, other))
        )
          throw Error(
            "Essa substituição não respeita a disponibilidade ou a regra da dupla.",
          );
        d.assigned = d.assigned.map((x) => (x === old ? id : x));
        d.substitutions.push({ from: old, to: id });
        d.status = "alterado";
        if (body.recalculate) {
          const next = new Date(d.date + "T12:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          const from = next.toISOString().slice(0, 10);
          for (const m of [
            ...new Set(
              s.days
                .filter((x) => x.date >= from)
                .map((x) => x.date.slice(0, 7)),
            ),
          ])
            s = generate(s, m, today, "future", from);
        }
      }
    }
  } else if (action === "demo") {
    if (s.employees.length)
      throw Error("O exemplo só pode ser carregado com o cadastro vazio.");
    s.employees = [
      "Ana Martins",
      "Bruno Costa",
      "Camila Souza",
      "Daniel Oliveira",
      "Elisa Santos",
      "Felipe Almeida",
      "Gabriela Lima",
      "Henrique Silva",
    ].map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      sector: ["Administrativo", "Atendimento", "Operações"][i % 3],
      status: "ativo",
      start: month + "-01",
      participates: true,
      notes: "Funcionário fictício para demonstração.",
      weekdays: [1, 2, 3, 4, 5],
    }));
    s = generate(s, month, month + "-01", "all");
  } else throw Error("Ação não reconhecida.");
  s.days.sort((a, b) => a.date.localeCompare(b.date));
  return s;
}
