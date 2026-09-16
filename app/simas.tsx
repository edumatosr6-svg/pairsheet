"use client";
import { Login, PasswordForm } from "./account";
import { useState, useEffect } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  CalendarOff,
  History,
  ChartNoAxesCombined,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Check,
  Download,
  RefreshCw,
  X,
  Search,
  MoreHorizontal,
  ShieldCheck,
  LogOut,
  Sparkles,
  Menu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Printer,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import {
  blankState,
  dates,
  weekday,
  weekKey,
  available,
  summary,
  pairHistory,
  substitutes,
  conflicts,
  makeDay,
  works,
  type State,
  type Day,
  type Employee,
} from "../lib/domain";
const tabs = [
  ["Início", LayoutDashboard],
  ["Escala", CalendarDays],
  ["Funcionários", Users],
  ["Disponibilidades", CalendarOff],
  ["Histórico", History],
  ["Relatórios", ChartNoAxesCombined],
  ["Configurações", Settings],
] as const;
const fmt = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" },
) => new Date(date + "T12:00:00").toLocaleDateString("pt-BR", options);
const initials = (n: string) =>
  n
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
const todayValue = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
type User = { id: string; name: string; email: string; role: string };
type Modal = {
  type: string;
  employee?: Employee;
  date?: string;
  person?: string;
};
export default function Simas() {
  const [state, setState] = useState<State>(blankState()),
    [revision, setRevision] = useState(0),
    [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [auth, setAuth] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("Escala"),
    [month, setMonth] = useState(todayValue().slice(0, 7)),
    [modal, setModal] = useState<Modal | null>(null),
    [query, setQuery] = useState(""),
    [sector, setSector] = useState("Todos os setores"),
    [view, setView] = useState("calendar"),
    [mobile, setMobile] = useState(false);
  const today = todayValue(),
    admin = user?.role === "admin";
  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/state");
      const d = (await r.json()) as {
        state: State;
        revision: number;
        user: User;
        error: string;
      };
      if (r.status === 401) {
        setAuth(true);
        return;
      }
      if (!r.ok) throw Error(d.error);
      receive(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function receive(d: {
    state: State;
    revision: number;
    user: User;
  }) {
    setState(d.state);
    setRevision(d.revision);
    setUser(d.user);
    setAuth(false);
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const first = dialog?.querySelector<HTMLElement>(
      "input,select,button,textarea",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab" && dialog) {
        const list = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a,input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ),
        ).filter((el) => el.getClientRects().length);
        const start = list[0],
          end = list.at(-1);
        if (e.shiftKey && document.activeElement === start) {
          e.preventDefault();
          end?.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          start?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal?.type, modal?.date, busy]);
  async function save(body: Record<string, unknown>, close = true) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, revision, ...body }),
      });
      const d = (await r.json()) as {
        state: State;
        revision: number;
        user: User;
        error: string;
      };
      if (!r.ok) {
        if (r.status === 409) {
          const fresh = await fetch("/api/state");
          if (fresh.ok)
            receive(
              (await fresh.json()) as {
                state: State;
                revision: number;
                user: User;
              },
            );
        }
        throw Error(d.error);
      }
      receive(d);
      if (close) setModal(null);
      setNotice("Alterações salvas com sucesso.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string) =>
    state.employees.find((e) => e.id === id)?.name ?? "Funcionário removido";
  const color = (id: string) =>
    ["mint", "blue", "purple", "amber", "rose", "cyan"][
      Math.max(
        0,
        state.employees.findIndex((e) => e.id === id),
      ) % 6
    ];
  const avatar = (id: string) => (
    <span className={"avatar " + color(id)}>{initials(name(id))}</span>
  );
  const stats = summary(state, month),
    monthDays = state.days.filter((d) => d.date.startsWith(month)),
    workDays = monthDays.filter(works),
    filled = workDays.filter((d) => d.assigned.length === 2),
    done = workDays.filter((d) => d.status === "confirmado"),
    issues = conflicts(state).filter((c) => c.date.startsWith(month));
  const active = stats.filter((e) => e.status === "ativo" && e.participates),
    weekAnchor = month === today.slice(0, 7) ? today : dates(month).find((date) => weekday(date) === 1) ?? month + "-01",
    selectedWeek = weekKey(weekAnchor),
    selectedWeekDays = workDays.filter((d) => weekKey(d.date) === selectedWeek),
    weeklyStats = active
      .filter((e) => selectedWeekDays.some((d) => available(state, e, d.date)))
      .map((e) => ({ ...e, planned: selectedWeekDays.filter((d) => d.assigned.includes(e.id)).length })),
    numbers = weeklyStats.map((e) => e.planned),
    weeklyFilled = selectedWeekDays.filter((d) => d.assigned.length === 2),
    spread = numbers.length ? Math.max(...numbers) - Math.min(...numbers) : 0;
  const balance =
    numbers.length && weeklyFilled.length
      ? Math.max(
          0,
          Math.round(
            100 - (Math.max(0, spread - 1) / Math.max(1, ...numbers)) * 100,
          ),
        )
      : 0;
  const monthTitle = fmt(month + "-01", { month: "long", year: "numeric" });
  const day = modal?.date
    ? (state.days.find((d) => d.date === modal.date) ?? makeDay(modal.date))
    : null;
  const shift = (n: number) => {
    const d = new Date(month + "-15T12:00:00");
    d.setMonth(d.getMonth() + n);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  function changeTab(value: string) {
    setTab(value);
    setQuery("");
    setMobile(false);
  }
  async function exportFile(kind: string) {
    setBusy(true);
    try {
      const rows = monthDays
        .filter(works)
        .map((d) => [
          fmt(d.date, { day: "2-digit", month: "2-digit", year: "numeric" }),
          fmt(d.date, { weekday: "long" }),
          d.assigned[0] ? name(d.assigned[0]) : "—",
          d.assigned[1] ? name(d.assigned[1]) : "—",
          d.status,
        ]);
      if (kind === "excel") {
        const { Workbook } = await import("exceljs");
        const wb = new Workbook();
        wb.creator = "SIMAS";
        const sheets = [
          {
            name: "Escala",
            headers: [
              "Data",
              "Dia da semana",
              "Funcionário 1",
              "Funcionário 2",
              "Status",
            ],
            rows,
          },
          {
            name: "Resumo",
            headers: [
              "Funcionário",
              "Participações previstas",
              "Participações realizadas",
              "Faltas",
              "Substituições",
            ],
            rows: stats.map((e) => [
              e.name,
              e.planned,
              e.actual,
              e.absences,
              e.substitutions,
            ]),
          },
          {
            name: "Duplas",
            headers: [
              "Funcionário 1",
              "Funcionário 2",
              "Quantidade de vezes juntos",
            ],
            rows: pairHistory({ ...state, days: monthDays }).map((p) => [
              name(p.a),
              name(p.b),
              p.count,
            ]),
          },
        ];
        for (const data of sheets) {
          const ws = wb.addWorksheet(data.name);
          ws.addRow(data.headers);
          ws.addRows(data.rows);
          ws.columns.forEach((c) => (c.width = 28));
          ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
          ws.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF147D6E" },
          };
          ws.views = [{ state: "frozen", ySplit: 1 }];
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: data.headers.length },
          };
        }
        download(
          new Blob([await wb.xlsx.writeBuffer()], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          `SIMAS-${month}.xlsx`,
        );
      } else if (kind === "pdf") {
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.text("SIMAS | " + monthTitle, 15, 20);
        doc.setFontSize(10);
        let y = 34;
        for (const row of rows) {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }
          doc.text(`${row[0]}  |  ${row[2]} + ${row[3]}  |  ${row[4]}`, 15, y);
          y += 9;
        }
        doc.save(`SIMAS-${month}.pdf`);
      } else window.print();
      setModal(null);
    } catch {
      setError("Não foi possível exportar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const monthControl = (
    <div className="month-picker">
      <button aria-label="Mês anterior" onClick={() => shift(-1)}>
        <ChevronLeft size={18} />
      </button>
      <label>
        <CalendarDays size={17} />
        <span>{monthTitle}</span>
        <input
          aria-label="Selecionar mês"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <button aria-label="Próximo mês" onClick={() => shift(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
  const dayButton = (d: Day) => (
    <button
      className="day-pair"
      onClick={() => setModal({ type: "day", date: d.date })}
    >
      {d.assigned.map((id) => (
        <span key={id}>
          {avatar(id)}
          {name(id).split(" ").slice(0, 2).join(" ")}
        </span>
      ))}
    </button>
  );
  return (
    <div className="shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href="/" aria-label="SIMAS início">
          <span className="brand-mark">
            <Users size={25} />
          </span>
          SIMAS<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">E</span>
          <div>
            Minha equipe<small>Gestão de escalas</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">PRINCIPAL</p>
        <nav>
          {tabs.map(([label, Icon]) => (
            <button
              className={tab === label ? "nav-item selected" : "nav-item"}
              key={label}
              onClick={() => changeTab(label)}
            >
              <Icon size={19} />
              {label}
              {label === "Escala" && (
                <span className="nav-count">{filled.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tip">
            <ShieldCheck size={22} />
            <strong>Uma escala mais justa</strong>
            <p>O equilíbrio da equipe começa com uma boa distribuição.</p>
          </div>
          <div className="profile">
            <span className="avatar mint">
              {initials(user?.name ?? "Minha conta")}
            </span>
            <div>
              <strong>{user?.name ?? "Minha conta"}</strong>
              <small>{admin ? "Administrador" : "Consulta"}</small>
            </div>
            <button aria-label="Sair" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});setUser(null);setState(blankState());setAuth(true);setModal(null);}}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-toggle"
              aria-label="Abrir menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Minha equipe <ChevronRight size={14} />
            </span>
            <strong>{tab}</strong>
          </div>
          <div className="top-right">
            <span className="date-label">
              <CalendarDays size={15} />
              {fmt(today, { day: "numeric", month: "long", year: "numeric" })}
            </span>
            <span className="top-divider" />
            <span className="avatar mint">{initials(user?.name ?? "MC")}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ORGANIZAÇÃO QUE CUIDA DA EQUIPE</div>
              <h1>
                {tab === "Escala"
                  ? "Escala mensal"
                  : tab === "Início"
                    ? "Tudo pronto para hoje?"
                    : tab}
              </h1>
              <p>
                {
                  (
                    {
                      Escala:
                        "Pessoas certas, responsabilidades bem distribuídas.",
                      Início:
                        "Acompanhe os responsáveis e resolva o dia a dia.",
                      Funcionários:
                        "Conheça e organize quem faz parte da escala.",
                      Disponibilidades:
                        "Férias, folgas e compromissos em um só lugar.",
                      Histórico: "Cada participação e alteração registrada.",
                      Relatórios:
                        "Uma visão clara da distribuição da sua equipe.",
                      Configurações:
                        "Ajuste as regras e os acessos da sua equipe.",
                    } as Record<string, string>
                  )[tab]
                }
              </p>
            </div>
            <div className="heading-actions">
              {["Escala", "Relatórios"].includes(tab) && (
                <button
                  className="button"
                  onClick={() => setModal({ type: "export" })}
                >
                  <Download size={17} />
                  Exportar escala
                </button>
              )}
              {admin &&
                (tab === "Funcionários" ? (
                  <button
                    className="button primary"
                    onClick={() => setModal({ type: "employee" })}
                  >
                    <Plus size={18} />
                    Novo funcionário
                  </button>
                ) : tab === "Disponibilidades" ? (
                  <button
                    className="button primary"
                    onClick={() => setModal({ type: "unavailable" })}
                  >
                    <Plus size={18} />
                    Nova indisponibilidade
                  </button>
                ) : tab === "Escala" ? (
                  <button
                    className="button primary"
                    onClick={() => setModal({ type: "generate" })}
                  >
                    <Sparkles size={17} />
                    Gerar escala
                  </button>
                ) : null)}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert error">
              <AlertTriangle size={18} />
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty panel">
              <RefreshCw className="spin" />
              <h3>Preparando sua equipe…</h3>
            </div>
          ) : auth ? (
            <Login onSuccess={load}/>
          ) : !user ? (
            <div className="empty panel">
              <h3>Não foi possível carregar o SIMAS</h3>
              <button className="button" onClick={load}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              {["Escala", "Início", "Relatórios"].includes(tab) && (
                <div className="stats-grid">
                  <Stat
                    title="Funcionários na escala"
                    value={active.length}
                    icon={<Users size={19} />}
                    foot="Ativos e participantes"
                  />
                  <Stat
                    title="Dias programados"
                    value={filled.length.toString().padStart(2, "0")}
                    icon={<CalendarDays size={19} />}
                    foot={`${done.length} dias com presença confirmada`}
                  />
                  <Stat
                    title="Equilíbrio da semana"
                    value={weeklyFilled.length ? balance + "%" : "—"}
                    icon={<ChartNoAxesCombined size={19} />}
                    foot={
                      weeklyFilled.length
                        ? `Diferença de ${spread} participação${spread === 1 ? "" : "ões"}`
                        : "Gere a escala para acompanhar"
                    }
                    accent
                  />
                  <Stat
                    title="Pontos de atenção"
                    value={
                      issues.length +
                      workDays.filter((d) => d.assigned.length < 2).length
                    }
                    icon={<ShieldCheck size={19} />}
                    foot={
                      issues.length
                        ? "Há indisponibilidades na escala"
                        : "Disponibilidades verificadas"
                    }
                  />
                </div>
              )}
              {issues.length > 0 && (
                <div className="alert warning">
                  <AlertTriangle size={18} />
                  <span>
                    <strong>{issues.length} conflito(s) na escala.</strong>{" "}
                    Confira as indisponibilidades antes de publicar.
                  </span>
                  {admin && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => save({ action: "fix" })}
                    >
                      Corrigir escala
                    </button>
                  )}
                </div>
              )}
              {tab === "Escala" && (
                <>
                  <section className="panel calendar-panel">
                    <div className="calendar-toolbar">
                      <div className="calendar-title">
                        {monthControl}
                        <button
                          className="today-button"
                          onClick={() => setMonth(today.slice(0, 7))}
                        >
                          Hoje
                        </button>
                        <span
                          className={
                            "badge " +
                            (state.published.includes(month)
                              ? "confirmed"
                              : "draft")
                          }
                        >
                          {state.published.includes(month)
                            ? "Publicada"
                            : "Rascunho"}
                        </span>
                      </div>
                      <div className="calendar-options">
                        <select
                          aria-label="Filtrar setor"
                          value={sector}
                          onChange={(e) => setSector(e.target.value)}
                        >
                          <option>Todos os setores</option>
                          {[...new Set(state.employees.map((e) => e.sector))]
                            .filter(Boolean)
                            .map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                        </select>
                        <div className="segmented">
                          <button
                            aria-label="Ver calendário"
                            className={view === "calendar" ? "on" : ""}
                            onClick={() => setView("calendar")}
                          >
                            <CalendarDays size={17} />
                          </button>
                          <button
                            aria-label="Ver lista"
                            className={view === "list" ? "on" : ""}
                            onClick={() => setView("list")}
                          >
                            <Menu size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {view === "calendar" ? (
                      <div className="calendar">
                        <div className="weekdays">
                          {[
                            "DOM",
                            "SEG",
                            "TER",
                            "QUA",
                            "QUI",
                            "SEX",
                            "SÁB",
                          ].map((w) => (
                            <span key={w}>{w}</span>
                          ))}
                        </div>
                        <div className="calendar-grid">
                          {Array.from(
                            { length: weekday(month + "-01") },
                            (_, i) => (
                              <div
                                className="calendar-cell muted"
                                key={"empty" + i}
                              />
                            ),
                          )}
                          {dates(month).map((date) => {
                            const d =
                                monthDays.find((x) => x.date === date) ??
                                makeDay(date),
                              off = !works(d),
                              isToday = date === today,
                              filtered =
                                sector !== "Todos os setores" &&
                                !d.assigned.some(
                                  (id) =>
                                    state.employees.find((e) => e.id === id)
                                      ?.sector === sector,
                                );
                            return (
                              <div
                                key={date}
                                className={`calendar-cell ${off ? "off" : ""} ${isToday ? "is-today" : ""} ${filtered ? "filtered" : ""}`}
                              >
                                <div className="cell-head">
                                  <button
                                    className="date-number"
                                    onClick={() =>
                                      setModal({ type: "day", date })
                                    }
                                  >
                                    {Number(date.slice(-2))}
                                  </button>
                                  {isToday ? (
                                    <span className="today-label">HOJE</span>
                                  ) : d.assigned.length > 0 ? (
                                    <span
                                      className={"status-dot " + d.status}
                                      title={d.status}
                                    />
                                  ) : null}
                                  {admin && (
                                    <button
                                      className="cell-menu"
                                      aria-label={`Editar dia ${Number(date.slice(-2))}`}
                                      onClick={() =>
                                        setModal({ type: "day", date })
                                      }
                                    >
                                      <MoreHorizontal size={16} />
                                    </button>
                                  )}
                                </div>
                                {off ? (
                                  <span className="off-label">
                                    {d.kind === "sem SIMAS"
                                      ? "Sem SIMAS"
                                      : d.kind}
                                  </span>
                                ) : d.assigned.length ? (
                                  dayButton(d)
                                ) : (
                                  <button
                                    className="empty-day"
                                    onClick={() =>
                                      setModal({ type: "day", date })
                                    }
                                  >
                                    {workDays.length ? "Definir dupla" : "—"}
                                  </button>
                                )}
                                {!off &&
                                  d.status === "incompleto" &&
                                  monthDays.some((x) => x.date === date) && (
                                    <small className="incomplete-label">
                                      Dupla incompleta
                                    </small>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Data</th>
                              <th>Responsáveis</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {monthDays.filter(works).map((d) => (
                              <tr key={d.date}>
                                <td>
                                  {fmt(d.date, {
                                    day: "2-digit",
                                    month: "short",
                                    weekday: "short",
                                  })}
                                </td>
                                <td>
                                  {d.assigned.map(name).join(" + ") ||
                                    "Dupla incompleta"}
                                </td>
                                <td>
                                  <span className="badge">{d.status}</span>
                                </td>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setModal({ type: "day", date: d.date })
                                    }
                                  >
                                    Ver dia <ArrowUpRight size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="calendar-footer">
                      <div className="legend">
                        <span>
                          <i className="status-dot programado" />
                          Programado
                        </span>
                        <span>
                          <i className="status-dot confirmado" />
                          Confirmado
                        </span>
                        <span>
                          <i className="status-dot alterado" />
                          Alterado
                        </span>
                        <span>
                          <i className="status-dot incompleto" />
                          Incompleto
                        </span>
                      </div>
                      <span>Horário de Brasília</span>
                    </div>
                  </section>
                  <div className="below-calendar">
                    <span>
                      <ShieldCheck size={16} /> Dias confirmados são preservados
                      nos recálculos.
                    </span>
                    {admin && (
                      <button
                        className="text-button"
                        disabled={busy || state.published.includes(month)}
                        onClick={() => save({ action: "publish" })}
                      >
                        {state.published.includes(month)
                          ? "Escala publicada"
                          : "Publicar escala"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                  {!state.employees.length && (
                    <div className="onboarding">
                      <div>
                        <strong>Sua primeira escala começa pela equipe</strong>
                        <p>
                          Cadastre os funcionários ou explore um exemplo com
                          nomes fictícios.
                        </p>
                      </div>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => save({ action: "demo" })}
                      >
                        Carregar exemplo
                      </button>
                      <button
                        className="button primary"
                        onClick={() => changeTab("Funcionários")}
                      >
                        Cadastrar equipe <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  <Distribution stats={weeklyStats} avatar={avatar} />
                </>
              )}
              {tab === "Início" && (
                <div className="dashboard-columns">
                  <section className="panel today-card">
                    <div className="section-heading">
                      <h2>SIMAS de hoje</h2>
                      <span className="badge mint">
                        {fmt(today, { weekday: "long" })}
                      </span>
                    </div>
                    <p>
                      {fmt(today, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                    {state.days
                      .find((d) => d.date === today)
                      ?.assigned.map((id) => (
                        <div className="today-person" key={id}>
                          {avatar(id)}
                          <div>
                            <strong>{name(id)}</strong>
                            <small>
                              {state.employees.find((e) => e.id === id)?.sector}
                            </small>
                          </div>
                        </div>
                      ))}
                    {!state.days.find((d) => d.date === today)?.assigned
                      .length && <p>Nenhuma dupla definida para hoje.</p>}
                    <button
                      className="button primary"
                      onClick={() => setModal({ type: "day", date: today })}
                    >
                      Acompanhar este dia <ArrowRight size={17} />
                    </button>
                  </section>
                  <section className="panel upcoming">
                    <h2>Próximos dias</h2>
                    {state.days
                      .filter((d) => d.date > today && works(d))
                      .slice(0, 5)
                      .map((d) => (
                        <button
                          className="upcoming-row"
                          key={d.date}
                          onClick={() =>
                            setModal({ type: "day", date: d.date })
                          }
                        >
                          <span className="date-box">
                            <strong>{d.date.slice(-2)}</strong>
                            <small>{fmt(d.date, { weekday: "short" })}</small>
                          </span>
                          <span>
                            {d.assigned.map(name).join(" + ") ||
                              "Dupla incompleta"}
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                  </section>
                </div>
              )}
              {tab === "Funcionários" && (
                <section className="panel">
                  <div className="table-toolbar">
                    <h2>
                      Equipe{" "}
                      <span className="count">{state.employees.length}</span>
                    </h2>
                    <label className="search">
                      <Search size={17} />
                      <input
                        placeholder="Buscar funcionário…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Funcionário</th>
                          <th>Setor</th>
                          <th>Status</th>
                          <th>Participa do SIMAS</th>
                          <th>Entrada</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {state.employees
                          .filter((e) =>
                            e.name.toLowerCase().includes(query.toLowerCase()),
                          )
                          .map((e) => (
                            <tr key={e.id}>
                              <td>
                                <span className="person">
                                  {avatar(e.id)}
                                  <strong>{e.name}</strong>
                                </span>
                              </td>
                              <td>{e.sector || "—"}</td>
                              <td>
                                <span
                                  className={
                                    "badge " +
                                    (e.status === "ativo"
                                      ? "confirmed"
                                      : "draft")
                                  }
                                >
                                  {e.status}
                                </span>
                              </td>
                              <td>{e.participates ? "Sim" : "Não"}</td>
                              <td>{fmt(e.start)}</td>
                              <td>
                                {admin && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setModal({
                                        type: "employee",
                                        employee: e,
                                      })
                                    }
                                  >
                                    Editar
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!state.employees.length && (
                    <Empty
                      title="Vamos conhecer sua equipe?"
                      text="Adicione os funcionários que vão participar da escala."
                    />
                  )}
                </section>
              )}
              {tab === "Disponibilidades" && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Ausências e períodos</h2>
                      <span className="count">{state.unavailable.length}</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Funcionário</th>
                            <th>Motivo</th>
                            <th>De</th>
                            <th>Até</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {state.unavailable.map((u) => (
                            <tr key={u.id}>
                              <td>
                                <span className="person">
                                  {avatar(u.employee)}
                                  {name(u.employee)}
                                </span>
                              </td>
                              <td>
                                <span className="badge draft">{u.type}</span>
                              </td>
                              <td>
                                {fmt(u.from, {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })}
                              </td>
                              <td>
                                {fmt(u.to, {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })}
                              </td>
                              <td>
                                {admin && (
                                  <button
                                    className="text-button"
                                    disabled={busy}
                                    onClick={() =>
                                      save({
                                        action: "remove-unavailable",
                                        id: u.id,
                                      })
                                    }
                                  >
                                    Remover
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!state.unavailable.length && (
                      <Empty
                        title="Nenhuma indisponibilidade cadastrada"
                        text="Informe férias, folgas e afastamentos para evitar conflitos."
                      />
                    )}
                  </section>
                  <div className="information">
                    <CalendarDays size={21} />
                    <div>
                      <strong>Disponibilidade recorrente</strong>
                      <p>
                        Os dias da semana em que cada pessoa trabalha podem ser
                        ajustados no cadastro do funcionário.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => changeTab("Funcionários")}
                    >
                      Ver equipe <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {tab === "Histórico" && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>Registro de atividades</h2>
                    <span className="badge">
                      {state.audit.length} alterações
                    </span>
                  </div>
                  {state.audit.length ? (
                    state.audit.map((a, i) => (
                      <div className="audit-row" key={i}>
                        <span className="audit-icon">
                          <History size={17} />
                        </span>
                        <div>
                          <strong>{a.message}</strong>
                          <small>{a.actor}</small>
                        </div>
                        <time>{new Date(a.at).toLocaleString("pt-BR")}</time>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Tudo começa aqui"
                      text="As alterações e presenças confirmadas aparecerão neste histórico."
                    />
                  )}
                </section>
              )}
              {tab === "Relatórios" && (
                <>
                  <div className="report-toolbar">
                    {monthControl}
                    <span>
                      Participações realizadas contam após a confirmação de
                      presença.
                    </span>
                  </div>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Previsto × realizado</h2>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Funcionário</th>
                            <th>Previstas</th>
                            <th>Realizadas</th>
                            <th>Faltas</th>
                            <th>Substituições</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.map((e) => (
                            <tr key={e.id}>
                              <td>
                                <span className="person">
                                  {avatar(e.id)}
                                  {e.name}
                                </span>
                              </td>
                              <td>{e.planned}</td>
                              <td>{e.actual}</td>
                              <td>{e.absences}</td>
                              <td>{e.substitutions}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel pair-report">
                    <div className="section-heading">
                      <h2>Duplas realizadas no mês</h2>
                      <span className="badge">Histórico real</span>
                    </div>
                    {pairHistory({ ...state, days: monthDays }).map((p) => (
                      <div className="pair-row" key={p.a + p.b}>
                        <span>
                          {name(p.a)} + {name(p.b)}
                        </span>
                        <strong>{p.count} vez(es)</strong>
                      </div>
                    ))}
                    {!pairHistory({ ...state, days: monthDays }).length && (
                      <Empty
                        title="Ainda sem participações confirmadas"
                        text="Confirme as presenças para acompanhar o histórico real das duplas."
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "Configurações" && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Regras de dupla</h2>
                        <p>
                          Defina combinações permitidas, a evitar ou bloqueadas.
                        </p>
                      </div>
                      {admin && (
                        <button
                          className="button"
                          onClick={() => setModal({ type: "rule" })}
                        >
                          <Plus size={16} />
                          Adicionar regra
                        </button>
                      )}
                    </div>
                    {state.rules.map((r) => (
                      <div className="pair-row" key={r.a + r.b}>
                        <span>
                          {name(r.a)} + {name(r.b)}
                        </span>
                        <span className="badge">{r.rule}</span>
                      </div>
                    ))}
                    {!state.rules.length && (
                      <Empty
                        title="Todas as combinações estão permitidas"
                        text="O SIMAS procura variar as duplas automaticamente."
                      />
                    )}
                  </section>
                  {admin && <section className="panel pair-report">
                    <div className="section-heading">
                      <div>
                        <h2>Acesso ao SIMAS</h2>
                        <p>Uma senha protege a escala em todos os dispositivos.</p>
                      </div>
                      <button className="button" onClick={() => setModal({ type: "password" })}>Trocar senha</button>
                    </div>
                  </section>}
                </>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              SIMAS <span>·</span> Gestão de escalas
            </span>
            <span>Feito para distribuir melhor.</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">SIMAS · MINHA EQUIPE</div>
                <h2 id="modal-title">
                  {
                    (
                      {
                        password: "Trocar senha",
                        employee: modal.employee
                          ? "Editar funcionário"
                          : "Novo funcionário",
                        unavailable: "Nova indisponibilidade",
                        generate: "Gerar escala",
                        day: modal.date
                          ? fmt(modal.date, {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })
                          : "",
                        substitute: "Substituir funcionário",
                        export: "Exportar escala",
                        rule: "Regra de dupla",
                      } as Record<string, string>
                    )[modal.type]
                  }
                </h2>
              </div>
              <button
                aria-label="Fechar"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X size={21} />
              </button>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {modal.type === "password" && <PasswordForm onSuccess={()=>{setModal(null);setUser(null);setAuth(true);setNotice("Senha atualizada. Entre novamente.");}}/>}
            {modal.type === "employee" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save({
                    action: "employee",
                    employee: {
                      id: modal.employee?.id,
                      name: f.get("name"),
                      sector: f.get("sector"),
                      status: f.get("status"),
                      start: f.get("start"),
                      participates: f.get("participates") === "on",
                      notes: f.get("notes"),
                      weekdays: f.getAll("weekdays").map(Number),
                    },
                  });
                }}
              >
                <Field label="Nome completo">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={modal.employee?.name}
                    placeholder="Ex.: Ana Martins"
                    autoFocus
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Setor">
                    <input
                      name="sector"
                      defaultValue={modal.employee?.sector}
                      placeholder="Ex.: Administrativo"
                    />
                  </Field>
                  <Field label="Data de entrada">
                    <input
                      name="start"
                      type="date"
                      required
                      defaultValue={modal.employee?.start ?? today}
                    />
                  </Field>
                </div>
                <Field label="Status">
                  <select
                    name="status"
                    defaultValue={modal.employee?.status ?? "ativo"}
                  >
                    {["ativo", "férias", "afastado", "inativo"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    name="participates"
                    defaultChecked={modal.employee?.participates ?? true}
                  />
                  Participa do SIMAS
                </label>
                <fieldset>
                  <legend>Dias disponíveis na semana</legend>
                  <div className="weekday-checks">
                    {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                      (w, i) => (
                        <label key={w}>
                          <input
                            name="weekdays"
                            type="checkbox"
                            value={i}
                            defaultChecked={(
                              modal.employee?.weekdays ?? [1, 2, 3, 4, 5]
                            ).includes(i)}
                          />
                          {w}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <Field label="Observações">
                  <textarea
                    name="notes"
                    rows={3}
                    defaultValue={modal.employee?.notes}
                    placeholder="Informações adicionais (opcional)"
                  />
                </Field>
                <p className="form-hint">
                  A escala futura será ajustada ao salvar. Para férias com data
                  de retorno, prefira cadastrar uma indisponibilidade.
                </p>
                <FormFooter
                  busy={busy}
                  cancel={() => setModal(null)}
                  label="Salvar funcionário"
                />
              </form>
            )}
            {modal.type === "unavailable" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save({
                    action: "unavailable",
                    unavailable: Object.fromEntries(f),
                  });
                }}
              >
                <Field label="Funcionário">
                  <select name="employee" required>
                    <option value="">Selecione uma pessoa</option>
                    {state.employees.map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Motivo">
                  <select name="type">
                    {[
                      "férias",
                      "folga",
                      "afastamento",
                      "treinamento",
                      "viagem",
                      "compromisso",
                      "outro",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="De">
                    <input
                      type="date"
                      name="from"
                      required
                      defaultValue={today}
                    />
                  </Field>
                  <Field label="Até">
                    <input
                      type="date"
                      name="to"
                      required
                      defaultValue={today}
                    />
                  </Field>
                </div>
                <div className="information compact">
                  <ShieldCheck size={20} />
                  <p>
                    O SIMAS identifica os dias afetados e permite corrigir a
                    escala sem alterar o que já aconteceu.
                  </p>
                </div>
                <FormFooter
                  busy={busy}
                  cancel={() => setModal(null)}
                  label="Salvar indisponibilidade"
                />
              </form>
            )}
            {modal.type === "generate" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save({
                    action: "generate",
                    month: f.get("month"),
                    mode: f.get("mode"),
                    from: f.get("from"),
                  });
                }}
              >
                <p className="modal-description">
                  A distribuição prioriza a justiça em cada semana: duas
                  participações por pessoa e nenhuma dupla repetida. Quando
                  uma pessoa está de férias, duas fazem três participações e
                  duas fazem duas.
                </p>
                <Field label="Mês da escala">
                  <input
                    type="month"
                    name="month"
                    defaultValue={month}
                    required
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </Field>
                <Field label="O que deseja recalcular?">
                  <select name="mode">
                    <option value="future">
                      A partir da data abaixo (recomendado)
                    </option>
                    <option value="day">Apenas o dia selecionado</option>
                    <option value="all">
                      Mês inteiro · preservando dias protegidos
                    </option>
                  </select>
                </Field>
                <Field label="A partir de">
                  <input
                    type="date"
                    name="from"
                    defaultValue={
                      month > today.slice(0, 7) ? month + "-01" : today
                    }
                    min={today}
                    required
                  />
                </Field>
                <div className="information compact">
                  <ShieldCheck size={22} />
                  <p>
                    Dias passados e presenças confirmadas serão preservados. Se
                    não houver dupla válida, o dia ficará incompleto.
                  </p>
                </div>
                <FormFooter
                  busy={busy}
                  cancel={() => setModal(null)}
                  label="Gerar escala"
                />
              </form>
            )}
            {modal.type === "day" && day && (
              <>
                <div className="day-status">
                  <span
                    className={
                      "badge " +
                      (day.status === "confirmado" ? "confirmed" : "draft")
                    }
                  >
                    {day.status}
                  </span>
                  <span>{day.kind}</span>
                </div>
                {day.assigned.map((id) => (
                  <div className="day-person" key={id}>
                    {avatar(id)}
                    <div>
                      <strong>{name(id)}</strong>
                      <small>
                        {day.absent.includes(id)
                          ? "Falta registrada"
                          : day.actual.includes(id)
                            ? "Presença confirmada"
                            : state.employees.find((e) => e.id === id)?.sector}
                      </small>
                    </div>
                    {admin && day.status !== "confirmado" && (
                      <div className="person-actions">
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({
                              type: "substitute",
                              date: day.date,
                              person: id,
                            })
                          }
                        >
                          Substituir
                        </button>
                        {day.date <= today && !day.absent.includes(id) && (
                          <button
                            className="danger-link"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                await save(
                                  {
                                    action: "absence",
                                    date: day.date,
                                    employee: id,
                                  },
                                  false,
                                )
                              )
                                setModal({
                                  type: "substitute",
                                  date: day.date,
                                  person: id,
                                });
                            }}
                          >
                            Marcar falta
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!day.assigned.length && (
                  <Empty
                    title={
                      works(day) ? "Nenhuma dupla definida" : "Dia sem escala"
                    }
                    text="As disponibilidades serão verificadas ao recalcular."
                  />
                )}
                {admin && (
                  <>
                    <Field label="Tipo de dia">
                      <select
                        disabled={
                          busy ||
                          day.date < today ||
                          day.status === "confirmado"
                        }
                        value={day.kind}
                        onChange={(e) =>
                          save(
                            {
                              action: "kind",
                              date: day.date,
                              kind: e.target.value,
                            },
                            false,
                          )
                        }
                      >
                        {[
                          "dia normal",
                          "feriado",
                          "sem SIMAS",
                          "evento interno",
                          "cancelado",
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="modal-footer">
                      {day.date >= today && day.status !== "confirmado" && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            save({
                              action: "generate",
                              mode: "day",
                              date: day.date,
                              from: day.date,
                            })
                          }
                        >
                          <RefreshCw size={16} />
                          Recalcular dia
                        </button>
                      )}
                      {day.date <= today &&
                        day.assigned.length === 2 &&
                        day.status !== "confirmado" && (
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              save({ action: "confirm", date: day.date })
                            }
                          >
                            <Check size={17} />
                            Confirmar presença
                          </button>
                        )}
                    </div>
                  </>
                )}
                {day.planned.length > 0 && (
                  <p className="form-hint">
                    Dupla originalmente prevista:{" "}
                    {day.planned.map(name).join(" + ")}.
                  </p>
                )}
              </>
            )}
            {modal.type === "substitute" && day && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save({
                    action: "substitute",
                    date: day.date,
                    employee: modal.person,
                    replacement: f.get("replacement"),
                    recalculate: f.get("recalculate") === "on",
                  });
                }}
              >
                <p className="modal-description">
                  Escolha quem vai substituir{" "}
                  <strong>{name(modal.person!)}</strong>. As melhores opções
                  aparecem primeiro.
                </p>
                {substitutes(state, day, modal.person!).map((e, i) => (
                  <label className="sub-option" key={e.id}>
                    <input
                      type="radio"
                      required
                      name="replacement"
                      value={e.id}
                      defaultChecked={i === 0}
                    />
                    {avatar(e.id)}
                    <span>
                      <strong>
                        {e.name}
                        {i === 0 && <em>Recomendado</em>}
                      </strong>
                      <small>
                        {e.planned} previstas · {e.pairs} dupla(s) com o colega
                      </small>
                      <small>
                        Última participação:{" "}
                        {e.last ? fmt(e.last) : "Ainda não participou"}
                      </small>
                    </span>
                  </label>
                ))}
                {!substitutes(state, day, modal.person!).length ? (
                  <Empty
                    title="Nenhum substituto disponível"
                    text="Revise as disponibilidades e as regras da dupla."
                  />
                ) : (
                  <>
                    <div className="information compact">
                      <AlertTriangle size={20} />
                      <p>
                        A substituição reduz uma participação prevista de{" "}
                        {name(modal.person!)} e acrescenta uma à pessoa
                        escolhida. Confira a quantidade acima antes de salvar.
                      </p>
                    </div>
                    <label className="checkbox-row">
                      <input
                        name="recalculate"
                        type="checkbox"
                        defaultChecked
                      />
                      Salvar e recalcular os próximos dias
                    </label>
                    <FormFooter
                      busy={busy}
                      cancel={() => setModal({ type: "day", date: day.date })}
                      label="Confirmar substituição"
                    />
                  </>
                )}
              </form>
            )}
            {modal.type === "rule" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save({
                    action: "rule",
                    rule: Object.fromEntries(new FormData(e.currentTarget)),
                  });
                }}
              >
                {["a", "b"].map((k, i) => (
                  <Field key={k} label={"Funcionário " + (i + 1)}>
                    <select required name={k}>
                      <option value="">Selecione</option>
                      {state.employees.map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
                <Field label="Combinação">
                  <select name="rule">
                    <option>permitida</option>
                    <option>evitar</option>
                    <option>bloqueada</option>
                  </select>
                </Field>
                <p className="form-hint">
                  As escalas futuras serão recalculadas ao salvar.
                </p>
                <FormFooter
                  busy={busy}
                  cancel={() => setModal(null)}
                  label="Salvar regra"
                />
              </form>
            )}
            {modal.type === "export" && (
              <>
                <p className="modal-description capitalize">
                  {monthTitle} · {filled.length} dias programados
                </p>
                {[
                  [
                    "excel",
                    FileSpreadsheet,
                    "Excel",
                    "Escala, resumo e histórico de duplas em três abas.",
                  ],
                  [
                    "pdf",
                    FileText,
                    "PDF",
                    "Uma versão pronta para compartilhar.",
                  ],
                  [
                    "print",
                    Printer,
                    "Imprimir",
                    "Imprima a visualização atual da escala.",
                  ],
                ].map(([key, Icon, title, description]) => {
                  const I = Icon as typeof FileText;
                  return (
                    <button
                      key={String(key)}
                      className="export-option"
                      disabled={busy}
                      onClick={() => exportFile(String(key))}
                    >
                      <span className="export-icon">
                        <I size={25} />
                      </span>
                      <span>
                        <strong>{String(title)}</strong>
                        <small>{String(description)}</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  );
                })}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  icon,
  foot,
  accent = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  foot: string;
  accent?: boolean;
}) {
  return (
    <section className={"stat-card " + (accent ? "accent" : "")}>
      <div>
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>
        {accent ? (
          <span className="tiny-check">
            <Check size={12} />
          </span>
        ) : null}
        {foot}
      </small>
    </section>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <CalendarDays size={29} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function FormFooter({
  busy,
  cancel,
  label,
}: {
  busy: boolean;
  cancel: () => void;
  label: string;
}) {
  return (
    <div className="modal-footer">
      <button type="button" className="button" disabled={busy} onClick={cancel}>
        Cancelar
      </button>
      <button className="button primary" disabled={busy} type="submit">
        {busy ? "Salvando…" : label}
      </button>
    </div>
  );
}
function Distribution({
  stats,
  avatar,
}: {
  stats: ReturnType<typeof summary>;
  avatar: (id: string) => React.ReactNode;
}) {
  const max = Math.max(1, ...stats.map((e) => e.planned));
  return (
    <section className="panel distribution">
      <div className="section-heading">
        <div>
          <h2>Distribuição de participações</h2>
          <p>Uma visão rápida do equilíbrio na semana.</p>
        </div>
        <span className="badge">Previstas</span>
      </div>
      <div className="distribution-grid">
        {stats
          .filter((e) => e.participates)
          .map((e) => (
            <div className="distribution-item" key={e.id}>
              <div>
                {avatar(e.id)}
                <span>{e.name}</span>
                <strong>{e.planned}</strong>
              </div>
              <div className="bar">
                <span style={{ width: (e.planned / max) * 100 + "%" }} />
              </div>
            </div>
          ))}
      </div>
      {!stats.length && (
        <p className="distribution-empty">
          A distribuição aparecerá depois de cadastrar a equipe e gerar a
          escala.
        </p>
      )}
    </section>
  );
}
