import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { blankState, type State } from "../../../lib/domain";
import { act } from "../../../lib/actions";
import { z } from "zod";
export const dynamic = "force-dynamic";
function db() {
  if (!env.DB)
    throw Error("O banco de dados está indisponível. Tente novamente.");
  return env.DB;
}
async function identity() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const database = db();
  // Owner-private platform policy protects initial administrator enrollment.
  await database
    .prepare(
      "INSERT OR IGNORE INTO users (id,email,name,role) SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM users WHERE role='admin') THEN 'viewer' ELSE 'admin' END",
    )
    .bind(user.userId, user.email, user.displayName)
    .run();
  return await database
    .prepare("SELECT id,email,name,role FROM users WHERE id=?")
    .bind(user.userId)
    .first<{ id: string; email: string; name: string; role: string }>();
}
async function read() {
  const database = db();
  await database
    .prepare(
      "INSERT OR IGNORE INTO workspace (id,revision,data) VALUES (?,0,?)",
    )
    .bind("simas", JSON.stringify(blankState()))
    .run();
  return (await database
    .prepare("SELECT revision,data FROM workspace WHERE id=?")
    .bind("simas")
    .first<{ revision: number; data: string }>())!;
}
export async function GET() {
  try {
    const user = await identity();
    if (!user)
      return Response.json(
        { error: "Entre na sua conta para acessar o SIMAS." },
        { status: 401 },
      );
    const row = await read();
    return Response.json({
      state: JSON.parse(row.data),
      revision: row.revision,
      user,
      users:
        user.role === "admin"
          ? (await db().prepare("SELECT id,name,email,role FROM users").all())
              .results
          : [],
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "Não foi possível carregar seus dados. Tente novamente." },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin)
      return Response.json({ error: "Origem não permitida." }, { status: 403 });
    const user = await identity();
    if (!user)
      return Response.json({ error: "Entre na sua conta." }, { status: 401 });
    if (user.role !== "admin")
      return Response.json(
        { error: "Somente administradores podem alterar a escala." },
        { status: 403 },
      );
    const body = z
      .object({
        action: z.string(),
        revision: z.number(),
        id: z.string().optional(),
        role: z.string().optional(),
        date: z.string().optional(),
        month: z.string().optional(),
      })
      .passthrough()
      .parse(await req.json());
    const row = await read();
    if (body.revision !== row.revision)
      return Response.json(
        {
          error:
            "Outra pessoa alterou os dados. Atualize a página antes de continuar.",
        },
        { status: 409 },
      );
    if (body.action === "user-role") {
      if (body.id === user.id)
        throw Error("Você não pode alterar seu próprio perfil.");
      if (!["admin", "viewer"].includes(body.role ?? ""))
        throw Error("Perfil inválido.");
      await db()
        .prepare("UPDATE users SET role=? WHERE id=?")
        .bind(body.role!, body.id!)
        .run();
      return GET();
    }
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const state = act(JSON.parse(row.data) as State, body, today);
    const labels: Record<string, string> = {
      employee: "Cadastro de funcionário atualizado",
      unavailable: "Indisponibilidade cadastrada",
      "remove-unavailable": "Indisponibilidade removida",
      generate: "Escala recalculada",
      fix: "Conflitos corrigidos",
      publish: "Escala publicada",
      rule: "Regra de dupla atualizada",
      confirm: "Presenças confirmadas",
      absence: "Falta registrada",
      substitute: "Funcionário substituído",
      kind: "Tipo de dia alterado",
      demo: "Exemplo demonstrativo carregado",
    };
    const previous = JSON.parse(row.data) as State;
    const changes = [
      "employees",
      "unavailable",
      "days",
      "rules",
      "published",
    ].flatMap((collection) => {
      const key = (item: unknown) => {
        if (typeof item === "string") return item;
        const r = item as Record<string, unknown>;
        return String(r.id ?? r.date ?? [r.a, r.b].sort().join("|"));
      };
      const before = new Map(
        (previous[collection as keyof State] as unknown[]).map((item) => [
          key(item),
          item,
        ]),
      );
      const after = new Map(
        (state[collection as keyof State] as unknown[]).map((item) => [
          key(item),
          item,
        ]),
      );
      return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) =>
        JSON.stringify(before.get(id)) === JSON.stringify(after.get(id))
          ? []
          : [
              {
                collection,
                before: before.get(id) ?? null,
                after: after.get(id) ?? null,
              },
            ],
      );
    });
    state.audit.unshift({
      at: new Date().toISOString(),
      actor: user.name,
      changes,
      message: `${labels[body.action] ?? body.action}${body.date ? " · " + body.date : ""}${body.month ? " · " + body.month : ""}`,
    });
    const result = await db()
      .prepare(
        "UPDATE workspace SET data=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .bind(JSON.stringify(state), "simas", row.revision)
      .run();
    if (!result.meta.changes)
      return Response.json(
        {
          error: "Os dados foram alterados em outra sessão. Atualize a página.",
        },
        { status: 409 },
      );
    return GET();
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.name === "ZodError"
              ? "Confira os campos obrigatórios e as datas."
              : e.message
            : "Não foi possível salvar.",
      },
      { status: 400 },
    );
  }
}
