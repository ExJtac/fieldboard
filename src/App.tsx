import { BillingSettings, ReportSchedules } from "./Delivery";
import {
  Analysis,
  Financials,
  Collaboration,
  ResourceDirectory,
  Notifications,
  WorkspaceSettings,
  OrganizationPicker,
  OrganizationAdmin,
} from "./Extended";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Layers3,
  LogOut,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Star,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import type { Dashboard } from "../server/metrics";
import type { Project, Metric, RecordRow, Kind, User } from "../server/domain";
import { api, send, moneyless, fmtDate } from "./api";
import { Auth, SharedReport } from "./Auth";
import {
  Editor,
  Modal,
  RecordDetails,
  recordDefault,
  recordFields,
  projectDefault,
  projectFields,
  type Field,
} from "./forms";
import { Badge, Empty, Overview, Timeline } from "./widgets";
const navigation = [
  ["Portfolio", Layers3],
  ["Overview", LayoutDashboard],
  ["Schedule", CalendarDays],
  ["Analysis", Activity],
  ["Financials", ShieldCheck],
  ["Collaboration", Users],
  ["Notifications", Bell],
  ["Resources", Users],
  ["Materials", Package],
  ["Daily reports", FileText],
  ["Issues & RFIs", TriangleAlert],
  ["Approvals", CheckCircle2],
  ["Documents", FolderOpen],
  ["Reports", Download],
  ["Activity", Activity],
  ["Settings", Settings],
] as const;
const pageFromUrl = () =>
  new URLSearchParams(location.search).get("page") || "Overview";
function App() {
  const [auth, setAuth] = useState<any>(null),
    [me, setMe] = useState<any>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [portfolio, setPortfolio] = useState<Dashboard[]>([]),
    [projectId, setProjectId] = useState(
      new URLSearchParams(location.search).get("project") || "",
    ),
    [page, setPage] = useState(pageFromUrl),
    [d, setD] = useState<Dashboard | null>(null),
    [section, setSection] = useState(
      new URLSearchParams(location.search).get("section") || "",
    ),
    [from, setFrom] = useState(
      new URLSearchParams(location.search).get("from") || "",
    ),
    [to, setTo] = useState(
      new URLSearchParams(location.search).get("to") || "",
    ),
    [asOf, setAsOf] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [loading, setLoading] = useState(false),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [publications, setPublications] = useState<any[]>([]),
    [exports, setExports] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [projectTeam, setProjectTeam] = useState<any[]>([]),
    [reportType, setReportType] = useState("weekly_owner"),
    [reportTitle, setReportTitle] = useState(""),
    [reportSections, setReportSections] = useState<string[]>([]),
    [portfolioFilters, setPortfolioFilters] = useState<Record<string, string>>(
      {},
    ),
    [templates, setTemplates] = useState<any[]>([]),
    [views, setViews] = useState<any>({ hidden: [], order: [], favorites: [] }),
    [mobile, setMobile] = useState(false),
    [shared, setShared] = useState<any>(null),
    [sort, setSort] = useState("name"),
    [showArchived, setShowArchived] = useState(false);
  const sequence = useRef(0);
  const shareToken = location.pathname.startsWith("/share/")
    ? location.pathname.split("/")[2]
    : null;
  const user = me?.user as User | undefined;
  const manager = !!user && ["admin", "pm"].includes(user.role);
  const editable = manager && !asOf;
  const canWrite = !!user && user.role !== "viewer" && !asOf;
  const query = new URLSearchParams({
    ...(section ? { sectionId: section } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(asOf ? { asOf: new Date(asOf).toISOString() } : {}),
  }).toString();
  const endpoint = (tail: string) =>
    `/projects/${projectId}/${tail}${query ? "?" + query : ""}`;
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 4500);
  };
  const fail = (e: any) => setError(e.message || String(e));
  async function bootstrap() {
    try {
      const status = await api("/auth/status");
      setAuth(status);
      if (status.user) {
        const who = await api("/me");
        setMe(who);
        if (!who.entitlement.allowed) return;
        const [ps, vs] = await Promise.all([
          api<Project[]>("/projects"),
          api("/views"),
        ]);
        setMe(who);
        setProjects(ps);
        setViews(vs);
        setProjectId((current) =>
          ps.some((p) => p.id === current)
            ? current
            : ps.find((p) => !p.data.archived)?.id || ps[0]?.id || "",
        );
      }
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    if (shareToken)
      api(`/publications/${shareToken}`).then(setShared).catch(fail);
    else void bootstrap();
  }, []);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!auth?.user || me?.entitlement?.allowed === false) return;
      const seq = ++sequence.current;
      if (!quiet) setLoading(true);
      try {
        const ps = await api<Project[]>("/projects");
        if (seq !== sequence.current) return;
        setProjects(ps);
        if (page === "Portfolio" || page === "Resources") {
          const data = await api<Dashboard[]>("/portfolio");
          if (seq !== sequence.current) return;
          setPortfolio(data);
        }
        if (projectId && user?.role !== "viewer") {
          const data = await api<Dashboard>(
            `/projects/${projectId}/dashboard${query ? "?" + query : ""}`,
          );
          if (seq !== sequence.current) return;
          setD(data);
          setProjectTeam(await api(`/projects/${projectId}/team`));
        }
        if (page === "Activity" && projectId)
          setEvents(await api(`/projects/${projectId}/events`));
        if (page === "Reports" && projectId) {
          setExports(await api(`/projects/${projectId}/exports`));
          if (manager)
            setPublications(await api(`/projects/${projectId}/publications`));
        }
        if (page === "Settings" && manager)
          setTemplates(await api("/templates"));
        if (page === "Settings" && user?.role === "admin")
          setMembers(await api("/users"));
        if (seq === sequence.current) {
          setStale(false);
          setError("");
        }
      } catch (e) {
        if (seq === sequence.current) {
          setStale(true);
          if (!quiet) fail(e);
        }
      } finally {
        if (seq === sequence.current) setLoading(false);
      }
    },
    [
      auth?.user,
      projectId,
      page,
      query,
      user?.role,
      manager,
      me?.entitlement?.allowed,
    ],
  );
  useEffect(() => {
    setD(null);
    void refresh();
    const timer = setInterval(() => void refresh(true), 30_000);
    const offline = () => setStale(true);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (shareToken) return;
    const params = new URLSearchParams({
      page,
      ...(projectId ? { project: projectId } : {}),
      ...(section ? { section } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    history.replaceState(null, "", "/?" + params);
  }, [page, projectId, section, from, to]);
  useEffect(() => {
    const listener = () => {
      const p = new URLSearchParams(location.search);
      setPage(p.get("page") || "Overview");
      setProjectId(p.get("project") || "");
      setSection(p.get("section") || "");
      setFrom(p.get("from") || "");
      setTo(p.get("to") || "");
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const navigate = (p: string) => {
    setPage(p);
    setSearch("");
    setMobile(false);
  };
  const openRecord = (kind: Kind, row?: RecordRow) => {
    if (!d) return;
    setModal({ type: "record", kind, row, key: crypto.randomUUID() });
  };
  async function saved() {
    await refresh(true);
    notify("Saved to your workspace");
  }
  const matches = (row: RecordRow) =>
    !search ||
    JSON.stringify(row.data).toLowerCase().includes(search.toLowerCase());
  const metric = async (m: Metric) => {
    try {
      setModal({
        type: "metric",
        value: await api(endpoint(`metrics/${m.key}`)),
      });
    } catch (e) {
      fail(e);
    }
  };
  async function saveView(v: any) {
    try {
      await send("/views", v, "PUT");
      setViews(v);
      if (v.filters) {
        if (
          v.filters.projectId &&
          projects.some((p) => p.id === v.filters.projectId)
        )
          setProjectId(v.filters.projectId);
        if ("section" in v.filters) setSection(v.filters.section);
        if ("from" in v.filters) setFrom(v.filters.from);
        if ("to" in v.filters) setTo(v.filters.to);
        if (v.filters.portfolio) {
          try {
            setPortfolioFilters(JSON.parse(v.filters.portfolio));
          } catch {}
        }
      }
      notify("View saved");
    } catch (e) {
      fail(e);
    }
  }
  const createProject = () => setModal({ type: "project" });
  const exportReport = async () => {
    try {
      const e = await send(endpoint("exports"), {
        type: reportType,
        portfolioFilters,
        includeArchived: showArchived,
        ...(reportTitle ? { title: reportTitle } : {}),
        ...(reportSections.length ? { sections: reportSections } : {}),
      });
      await refresh(true);
      setModal({ type: "export", id: e.id });
    } catch (e) {
      fail(e);
    }
  };
  if (shareToken) return <SharedReport data={shared} error={error} />;
  if (!auth)
    return (
      <div className="boot">
        <Layers3 />
        <h1>Opening Fieldboard</h1>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (!auth.user)
    return (
      <Auth
        oidcEnabled={auth.oidcEnabled}
        signupEnabled={auth.signupEnabled}
        setup={auth.setupRequired}
        tokenRequired={auth.setupTokenRequired}
        onDone={bootstrap}
      />
    );
  if (!me) return <div className="boot">Loading workspace…</div>;
  if (me?.entitlement?.allowed === false)
    return (
      <main className="shared">
        <h1>{me.organization.name}</h1>
        <OrganizationPicker />
        <BillingSettings />
        <button
          className="button secondary"
          onClick={async () => {
            await send("/auth/logout", {});
            location.href = "/";
          }}
        >
          Sign out
        </button>
      </main>
    );
  if (user?.role === "viewer")
    return (
      <main className="shared">
        <h1>Welcome, {user.name}</h1>
        <p>
          Your project manager can send you an approved, expiring report link.
          This account cannot access internal project records.
        </p>
        <button
          className="button"
          onClick={async () => {
            await send("/auth/logout", {});
            location.href = "/";
          }}
        >
          Sign out
        </button>
      </main>
    );
  const approvals = d
    ? [
        ...d.reports,
        ...d.revisions,
        ...(d.requests || []),
        ...(d.finances || []),
      ].filter((r) => r.data.status === "submitted")
    : [];
  const filteredTasks = d?.tasks.filter(matches) || [];
  const button = (label: string, action: () => void, secondary = false) => (
    <button
      className={`button ${secondary ? "secondary" : ""}`}
      onClick={action}
    >
      <Plus size={16} />
      {label}
    </button>
  );
  const recordActions = (r: RecordRow, edit = true) => (
    <div className="row-actions">
      <button
        className="text-button"
        onClick={() => setModal({ type: "details", row: r })}
      >
        View
      </button>
      {edit && canWrite && (
        <button className="text-button" onClick={() => openRecord(r.kind, r)}>
          Edit
        </button>
      )}
    </div>
  );
  const heading = (
    title: string,
    description: string,
    actions?: React.ReactNode,
  ) => (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <Layers3 size={27} />
          <span>
            fieldboard<small>BY CAS-TX</small>
          </span>
        </a>
        <div className="workspace-card">
          <span className="workspace-mark">
            {me.organization.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{me.organization.name}</strong>
            <small>Project workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation
            .filter(
              ([name]) =>
                name !== "Financials" ||
                ["admin", "pm", "accountant"].includes(user!.role),
            )
            .map(([name, Icon]) => (
              <button
                key={name}
                className={page === name ? "active" : ""}
                onClick={() => navigate(name)}
              >
                <Icon size={18} />
                <span>{name}</span>
                {name === "Approvals" && approvals.length > 0 && (
                  <b>{approvals.length}</b>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="open-source">
            <span className="tiny-dot green" /> Open source. Yours to build.
          </div>
          <a
            href="https://cas-tx.com/Dashboard"
            target="_blank"
            rel="noreferrer"
          >
            Made for the field. By CAS-TX.
            <ArrowUpRight size={13} />
          </a>
          <button className="profile" onClick={() => navigate("Settings")}>
            <span className="avatar">
              {user?.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{user?.name}</strong>
              <small>
                {user?.role === "admin"
                  ? "Workspace administrator"
                  : user?.role}
              </small>
            </span>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-shade"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <OrganizationPicker />
            <span>/</span>
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search records on this page"
                placeholder="Search this view…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              className="icon-btn notification"
              aria-label="Notification center"
              onClick={() => navigate("Notifications")}
            >
              <Bell size={19} />
              {approvals.length > 0 && <i />}
            </button>
            <button
              className="avatar small"
              aria-label="Account settings"
              onClick={() => navigate("Settings")}
            >
              {user?.name.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button onClick={() => void refresh()} className="text-button">
                Retry
              </button>
            </div>
          )}
          {stale && (
            <div className="notice amber">
              <TriangleAlert size={16} /> Connection interrupted. Displaying the
              last successful snapshot; updates may be missing.
            </div>
          )}
          <div className="page-header">
            <div>
              <p className="eyebrow">PROJECT CONTROL / {page.toUpperCase()}</p>
              <h1>
                {page === "Portfolio"
                  ? "Your projects. One clear view."
                  : page === "Settings"
                    ? "Your workspace, your way."
                    : d?.project.data.name ||
                      projects.find((p) => p.id === projectId)?.data.name ||
                      "A clearer view of the work."}
              </h1>
              <div className="project-meta">
                {d && page !== "Portfolio" && page !== "Settings" ? (
                  <>
                    <span>{d.project.data.code}</span>
                    <span>{d.project.data.customer}</span>
                    <span>
                      {d.project.data.location || "Location unconfirmed"}
                    </span>
                    <Badge value={d.health} />
                  </>
                ) : (
                  <span>
                    {page === "Portfolio"
                      ? "Keep the whole operation in view."
                      : page === "Settings"
                        ? "Manage access, preferences and your account."
                        : "Choose a project to get started."}
                  </span>
                )}
              </div>
            </div>
            <div className="actions">
              {page === "Portfolio"
                ? manager && (
                    <>
                      {button(
                        "Import project",
                        () => setModal({ type: "import" }),
                        true,
                      )}
                      {button("New project", createProject)}
                    </>
                  )
                : d && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() => void exportReport()}
                      >
                        <Download size={16} /> Export report
                      </button>
                      {canWrite &&
                        ["admin", "pm", "foreman"].includes(user!.role) &&
                        button("Daily report", () => openRecord("report"))}
                    </>
                  )}
            </div>
          </div>
          {page !== "Portfolio" && page !== "Settings" && (
            <div className="filter-bar">
              <label>
                <span>PROJECT</span>
                <select
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setSection("");
                  }}
                >
                  <option value="">Choose project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.data.name}
                      {p.data.archived ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>SECTION</span>
                <select
                  aria-label="Section filter"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                >
                  <option value="">All sections</option>
                  {d?.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.data.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>FROM</span>
                <input
                  aria-label="From date"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                <span>THROUGH</span>
                <input
                  aria-label="Through date"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <button
                className="text-button"
                onClick={() =>
                  void saveView({
                    ...views,
                    filters: {
                      ...(views.filters || {}),
                      projectId,
                      section,
                      from,
                      to,
                    },
                  })
                }
              >
                Save filters
              </button>
              {views.filters && (
                <button
                  className="text-button"
                  onClick={() => {
                    setProjectId(views.filters.projectId);
                    setSection(views.filters.section || "");
                    setFrom(views.filters.from || "");
                    setTo(views.filters.to || "");
                  }}
                >
                  Load filters
                </button>
              )}
              <div className="freshness">
                <span className={`tiny-dot ${stale ? "orange" : "green"}`} />
                {loading
                  ? "Refreshing…"
                  : d
                    ? `As of ${new Date(d.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "Awaiting records"}
                <button
                  className="icon-btn"
                  aria-label="Refresh dashboard"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>
          )}
          {d?.project.data.sample &&
            page !== "Portfolio" &&
            page !== "Settings" && (
              <div className="sample-note">
                <ShieldCheck size={15} />
                <strong>Sample project</strong>
                <span>
                  Specification fixture · missing records remain unconfirmed
                </span>
              </div>
            )}
          {asOf && (
            <div className="notice">
              Historical snapshot {new Date(asOf).toLocaleString()}. Editing is
              disabled.
              <button className="text-button" onClick={() => setAsOf("")}>
                Return to current data
              </button>
            </div>
          )}
          {page === "Notifications" && (
            <Notifications
              navigate={(id, page) => {
                setProjectId(id);
                navigate(page);
              }}
            />
          )}
          {d && page === "Analysis" && (
            <Analysis d={d} editable={editable} onSaved={saved} />
          )}
          {d &&
            page === "Financials" &&
            ["admin", "pm", "accountant"].includes(user!.role) && (
              <Financials
                editable={canWrite}
                manager={manager}
                d={d}
                open={openRecord}
                metric={metric}
                decision={(r) => {
                  if (editable)
                    setModal({ type: "decision", row: r, decision: "voided" });
                }}
              />
            )}
          {d && page === "Collaboration" && (
            <Collaboration
              d={d}
              user={user!}
              editable={canWrite}
              open={openRecord}
              onSaved={saved}
            />
          )}
          {d && page === "Resources" && (
            <ResourceDirectory d={d} editable={editable} onSaved={saved} />
          )}
          {page === "Settings" && user?.role === "admin" && (
            <OrganizationAdmin />
          )}
          {page === "Settings" && <BillingSettings />}
          {page === "Settings" && (
            <WorkspaceSettings
              user={user!}
              d={d}
              views={views}
              saveView={saveView}
            />
          )}
          {page === "Portfolio" && (
            <>
              <div className="portfolio-summary">
                <div>
                  <span>Active projects</span>
                  <strong>
                    {portfolio.filter((p) => !p.project.data.archived).length}
                  </strong>
                </div>
                <div>
                  <span>Need attention</span>
                  <strong>
                    {
                      portfolio.filter(
                        (p) =>
                          !p.project.data.archived && p.health === "attention",
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>Approved field hours</span>
                  <strong>
                    {portfolio.some(
                      (p) =>
                        p.metrics.find((m) => m.key === "actual_hours")
                          ?.value !== null,
                    )
                      ? moneyless(
                          portfolio.reduce(
                            (n, p) =>
                              n +
                              (p.metrics.find((m) => m.key === "actual_hours")
                                ?.value || 0),
                            0,
                          ),
                          "h",
                        )
                      : "No data"}
                  </strong>
                </div>
              </div>
              <section className="panel">
                {heading(
                  "Project portfolio",
                  "Open a project to inspect its source records.",
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />
                      Archived
                    </label>
                    <select
                      aria-label="Sort projects"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="name">Project name</option>
                      <option value="customer">Customer</option>
                      <option value="forecastFinish">Forecast finish</option>
                      <option value="manager">Project manager</option>
                    </select>
                  </>,
                )}
                <div className="portfolio-filters">
                  {[
                    "customer",
                    "division",
                    "manager",
                    "team",
                    "contractStage",
                    "health",
                  ].map((k) => (
                    <label key={k}>
                      {k === "contractStage" ? "Contract stage" : k}
                      <select
                        value={portfolioFilters[k] || ""}
                        onChange={(e) =>
                          setPortfolioFilters({
                            ...portfolioFilters,
                            [k]: e.target.value,
                          })
                        }
                      >
                        <option value="">All</option>
                        {[
                          ...new Set(
                            portfolio
                              .map((p) =>
                                k === "health"
                                  ? p.health
                                  : String((p.project.data as any)[k] || ""),
                              )
                              .filter(Boolean),
                          ),
                        ]
                          .sort()
                          .map((v) => (
                            <option key={v} value={v}>
                              {v.replaceAll("_", " ")}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!portfolioFilters.overdue}
                      onChange={(e) =>
                        setPortfolioFilters({
                          ...portfolioFilters,
                          overdue: e.target.checked ? "yes" : "",
                        })
                      }
                    />
                    Overdue milestones
                  </label>
                  <button
                    className="text-button"
                    onClick={() =>
                      saveView({
                        ...views,
                        filters: {
                          ...(views.filters || {}),
                          portfolio: JSON.stringify(portfolioFilters),
                        },
                      })
                    }
                  >
                    Save portfolio filters
                  </button>
                  {views.filters?.portfolio && (
                    <button
                      className="text-button"
                      onClick={() =>
                        setPortfolioFilters(JSON.parse(views.filters.portfolio))
                      }
                    >
                      Apply saved portfolio filters
                    </button>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project / customer</th>
                        <th>Health</th>
                        <th>Forecast finish</th>
                        <th>Progress</th>
                        <th>Approved hours</th>
                        <th>Manager</th>
                        <th>Favorite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio
                        .filter(
                          (p) =>
                            p.project.data.archived === showArchived &&
                            Object.entries(portfolioFilters).every(
                              ([k, v]) =>
                                !v ||
                                (k === "overdue"
                                  ? p.metrics.some(
                                      (m) => m.key === "overdue" && !!m.value,
                                    )
                                  : k === "health"
                                    ? p.health === v
                                    : String(
                                        (p.project.data as any)[k] || "",
                                      ) === v),
                            ) &&
                            JSON.stringify(p.project.data)
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .sort((a, b) =>
                          String((a.project.data as any)[sort]).localeCompare(
                            String((b.project.data as any)[sort]),
                          ),
                        )
                        .map((p) => (
                          <tr key={p.project.id}>
                            <td>
                              <button
                                className="cell-link"
                                onClick={() => {
                                  setProjectId(p.project.id);
                                  setSection("");
                                  navigate("Overview");
                                }}
                              >
                                {p.project.data.name}
                                <small>
                                  {p.project.data.customer}
                                  {p.project.data.sample ? " · SAMPLE" : ""}
                                </small>
                              </button>
                            </td>
                            <td>
                              <Badge value={p.health} />
                            </td>
                            <td>{fmtDate(p.project.data.forecastFinish)}</td>
                            <td>
                              {moneyless(
                                p.metrics.find((m) => m.key === "progress")
                                  ?.value,
                                "%",
                              )}
                            </td>
                            <td>
                              {moneyless(
                                p.metrics.find((m) => m.key === "actual_hours")
                                  ?.value,
                                "h",
                              )}
                            </td>
                            <td>{p.project.data.manager || "Unassigned"}</td>
                            <td>
                              <button
                                className="icon-btn"
                                aria-label="Toggle favorite"
                                onClick={() =>
                                  void saveView({
                                    ...views,
                                    favorites: views.favorites.includes(
                                      p.project.id,
                                    )
                                      ? views.favorites.filter(
                                          (id: string) => id !== p.project.id,
                                        )
                                      : [...views.favorites, p.project.id],
                                  })
                                }
                              >
                                <Star
                                  size={17}
                                  fill={
                                    views.favorites.includes(p.project.id)
                                      ? "#d8a348"
                                      : "none"
                                  }
                                />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!portfolio.length && (
                  <Empty
                    title="Your first project starts here"
                    action={manager && button("Create project", createProject)}
                  >
                    Create a project, add sections and begin recording the work.
                  </Empty>
                )}
              </section>
            </>
          )}
          {page !== "Portfolio" &&
            page !== "Settings" &&
            !d &&
            (loading ? (
              <div className="skeleton">
                <div />
                <div />
                <div />
              </div>
            ) : (
              <Empty
                title="Choose or create a project"
                action={manager && button("New project", createProject)}
              >
                Your workspace is ready for real project records.
              </Empty>
            ))}
          {d && page === "Overview" && (
            <Overview
              d={d}
              onMetric={metric}
              onRecord={(r) => setModal({ type: "details", row: r })}
              navigate={navigate}
              hidden={views.hidden}
              order={views.order}
            />
          )}
          {d && page === "Schedule" && (
            <>
              <section className="panel">
                {heading(
                  "Activity schedule",
                  "Baseline dates are preserved. Propose and approve revisions to change them.",
                  editable && (
                    <>
                      {button("Add section", () => openRecord("section"), true)}
                      {button("Add activity", () => openRecord("task"))}
                      {button(
                        "Propose revision",
                        () => openRecord("revision"),
                        true,
                      )}
                    </>
                  ),
                )}
                <Timeline
                  d={{ ...d, tasks: filteredTasks }}
                  onRecord={(r) => setModal({ type: "details", row: r })}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Activity</th>
                        <th>Baseline</th>
                        <th>Forecast</th>
                        <th>Estimate</th>
                        <th>Target quantity</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.data.name}</strong>
                            <small>{r.data.kind}</small>
                          </td>
                          <td>{fmtDate(r.data.baselineFinish)}</td>
                          <td>{fmtDate(r.data.forecastFinish)}</td>
                          <td>{moneyless(r.data.estimatedHours, "h")}</td>
                          <td>{moneyless(r.data.quantity, r.data.unit)}</td>
                          <td>{recordActions(r, editable)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel section-spacer">
                {heading(
                  "Sections & GC releases",
                  "Release evidence belongs with each section.",
                )}
                <div className="section-cards">
                  {d.sections.map((s) => (
                    <div key={s.id}>
                      <h3>{s.data.name}</h3>
                      <Badge
                        value={s.data.released ? "released" : "unconfirmed"}
                      />
                      <p>
                        {s.data.releaseReference ||
                          "No release evidence recorded"}
                      </p>
                      {recordActions(s, editable)}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {d && page === "Materials" && (
            <section className="panel">
              {heading(
                "Material register",
                "Delivery changes surface risk without changing the approved schedule.",
                canWrite &&
                  ["admin", "pm", "purchasing"].includes(user!.role) &&
                  button("Add material", () => openRecord("material")),
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material / activity</th>
                      <th>Status</th>
                      <th>Available / required</th>
                      <th>Expected arrival</th>
                      <th>Supplier / PO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.materials.filter(matches).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.data.name}</strong>
                          <small>
                            {
                              d.tasks.find((t) => t.id === r.data.taskId)?.data
                                .name
                            }
                          </small>
                          {d.lateMaterialIds.includes(r.id) && (
                            <span className="risk-label">Delivery risk</span>
                          )}
                        </td>
                        <td>
                          <Badge value={r.data.status} />
                        </td>
                        <td>
                          {r.data.received} / {r.data.required} {r.data.unit}
                        </td>
                        <td>
                          {fmtDate(r.data.expectedDate)}
                          <small>
                            {r.data.confirmed
                              ? "Supplier confirmed"
                              : "Unconfirmed"}
                          </small>
                        </td>
                        <td>
                          {r.data.supplier || "Unconfirmed"}
                          <small>{r.data.po || "No PO reference"}</small>
                        </td>
                        <td>
                          {recordActions(
                            r,
                            ["admin", "pm", "purchasing"].includes(user!.role),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!d.materials.length && (
                <Empty title="Add the materials that move the work">
                  Each requirement is linked to one activity, with its own
                  allocatable quantity.
                </Empty>
              )}
            </section>
          )}
          {d && page === "Resources" && (
            <>
              <div className="two-cards">
                {["estimated_hours", "crew_capacity"].map((k) => {
                  const m = d.metrics.find((m) => m.key === k)!;
                  return (
                    <button
                      className="kpi"
                      key={k}
                      onClick={() => void metric(m)}
                    >
                      <span>
                        {m.label}
                        <ArrowUpRight size={16} />
                      </span>
                      <strong>{moneyless(m.value, m.unit)}</strong>
                      <small>{m.coverage}</small>
                    </button>
                  );
                })}
              </div>
              <section className="panel">
                {heading(
                  "Crew assignments",
                  "Capacity uses project workdays, holidays and known unavailability.",
                  editable && button("Assign crew", () => openRecord("crew")),
                )}
                {d.crew.map((r) => (
                  <div key={r.id} className="list-row">
                    <div>
                      <h3>{r.data.name}</h3>
                      <p>
                        {r.data.workers} workers · {r.data.hoursPerDay} h/day ·{" "}
                        {fmtDate(r.data.start)} – {fmtDate(r.data.end)}
                      </p>
                    </div>
                    {recordActions(r, editable)}
                  </div>
                ))}
                {!d.crew.length && (
                  <Empty title="Plan your first crew assignment">
                    No crew capacity has been assumed from the estimate.
                  </Empty>
                )}
              </section>
              <section className="panel section-spacer">
                {heading(
                  "Cross-project assignment checks",
                  "Overlapping dates for the same named crew, across projects you can access. These are potential conflicts to review.",
                )}
                <CrewConflicts portfolio={portfolio} />
              </section>
            </>
          )}
          {d && page === "Daily reports" && (
            <section className="panel">
              {heading(
                "Daily field reports",
                "One activity per report. Only approved reports contribute hours and installed quantities.",
                canWrite &&
                  ["admin", "pm", "foreman"].includes(user!.role) &&
                  button("New daily report", () => openRecord("report")),
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Work date / activity</th>
                      <th>Accomplishments</th>
                      <th>Field / PM hours</th>
                      <th>Quantity</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.reports
                      .filter(matches)
                      .sort((a, b) => b.data.date.localeCompare(a.data.date))
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            {fmtDate(r.data.date)}
                            <small>
                              {
                                d.tasks.find((t) => t.id === r.data.taskId)
                                  ?.data.name
                              }
                            </small>
                          </td>
                          <td>{r.data.accomplishments}</td>
                          <td>
                            {r.data.hours} / {r.data.pmHours} h
                          </td>
                          <td>
                            {r.data.quantity}{" "}
                            {
                              d.tasks.find((t) => t.id === r.data.taskId)?.data
                                .unit
                            }
                          </td>
                          <td>
                            <Badge value={r.data.status} />
                          </td>
                          <td>
                            {recordActions(
                              r,
                              ["draft", "rejected"].includes(r.data.status) &&
                                ["admin", "pm", "foreman"].includes(user!.role),
                            )}
                            {editable && r.data.status === "approved" && (
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  setModal({
                                    type: "decision",
                                    row: r,
                                    decision: "voided",
                                  })
                                }
                              >
                                Void with reason
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!d.reports.length && (
                <Empty title="Capture the work, then verify it">
                  Record today's crew, hours, installed quantities and field
                  notes.
                </Empty>
              )}
            </section>
          )}
          {d && page === "Issues & RFIs" && (
            <section className="panel">
              {heading(
                "Issues, risks & clarifications",
                "Separate confirmed blockers from potential risks and open questions.",
                canWrite && button("Raise issue", () => openRecord("issue")),
              )}
              <div className="issue-grid">
                {d.issues.filter(matches).map((r) => (
                  <article className="issue-card" key={r.id}>
                    <div>
                      <Badge value={r.data.severity} />
                      <span>{r.data.type.toUpperCase()}</span>
                    </div>
                    <h3>{r.data.name}</h3>
                    <p>{r.data.notes || "No additional details"}</p>
                    <div className="issue-owner">
                      <span>{r.data.owner || "Unassigned"}</span>
                      <Badge value={r.data.status} />
                    </div>
                    <small>Due {fmtDate(r.data.dueDate)}</small>
                    {recordActions(r)}
                  </article>
                ))}
              </div>
              {!d.issues.length && (
                <Empty title="No issues recorded">
                  Log blockers, risks or RFIs as they arise.
                </Empty>
              )}
            </section>
          )}
          {d && page === "Approvals" && (
            <section className="panel">
              {heading(
                "Approval queue",
                "Review the source record before approving. Every decision requires a reason.",
              )}{" "}
              {approvals.filter(matches).map((r) => (
                <article className="approval" key={r.id}>
                  <div>
                    <p className="eyebrow">
                      {r.kind.replaceAll("_", " ").toUpperCase()}
                    </p>
                    <h3>{r.data.name || r.data.accomplishments}</h3>
                    <p>
                      {r.kind === "report"
                        ? `${fmtDate(r.data.date)} · ${r.data.hours} field hours · ${r.data.quantity} installed units`
                        : r.data.reason}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "details", row: r })}
                    >
                      Review full record <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {editable ? (
                    <div className="actions">
                      <button
                        className="button secondary"
                        onClick={() =>
                          setModal({
                            type: "decision",
                            row: r,
                            decision: "rejected",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        className="button"
                        onClick={() =>
                          setModal({
                            type: "decision",
                            row: r,
                            decision: "approved",
                          })
                        }
                      >
                        Approve
                      </button>
                    </div>
                  ) : (
                    <Badge value="submitted" />
                  )}
                </article>
              ))}
              {!approvals.length && (
                <Empty title="You're all caught up">
                  Submitted reports and schedule revisions will appear here.
                </Empty>
              )}
            </section>
          )}
          {d && page === "Documents" && (
            <section className="panel">
              {heading(
                "Project documents",
                "PDF, PNG and JPEG · up to 8 MB · downloads require a clean malware scan.",
                canWrite &&
                  ["admin", "pm", "foreman"].includes(user!.role) &&
                  button("Upload document", () => setModal({ type: "upload" })),
              )}
              {d.documents.filter(matches).map((r) => (
                <div className="list-row" key={r.id}>
                  <FileText size={24} />
                  <div className="grow">
                    <h3>{r.data.name}</h3>
                    <p>
                      {r.data.filename} · {Math.ceil(r.data.size / 1024)} KB
                    </p>
                  </div>
                  <Badge value={r.data.scanStatus} />
                  {r.data.scanStatus === "clean" ? (
                    <a
                      className="button secondary"
                      href={`/api/projects/${projectId}/documents/${r.id}`}
                    >
                      Download
                    </a>
                  ) : (
                    editable && (
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await send(
                              `/projects/${projectId}/documents/${r.id}/scan`,
                              {},
                            );
                            await saved();
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        Scan file
                      </button>
                    )
                  )}
                </div>
              ))}
              {!d.documents.length && (
                <Empty title="Keep the evidence close">
                  Attach field photos, release letters and delivery documents.
                </Empty>
              )}
            </section>
          )}
          {d && page === "Reports" && (
            <>
              {editable && (
                <ReportSchedules
                  d={d}
                  team={projectTeam}
                  report={{
                    type: reportType,
                    title: reportTitle,
                    sections: reportSections.length
                      ? reportSections
                      : undefined,
                    includeArchived: showArchived,
                    portfolioFilters,
                  }}
                />
              )}
              <section className="panel">
                <label>
                  Report layout
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value)}
                  >
                    {[
                      "weekly_owner",
                      "gc_lookahead",
                      "schedule_performance",
                      "open_issues",
                      "manpower_forecast",
                      "material_risks",
                      "productivity",
                      "milestone_log",
                      "portfolio",
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  The selected layout uses the current project, section, date
                  range and historical snapshot. Portfolio reports include
                  accessible projects only.
                </p>
                <label>
                  Custom report title
                  <input
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    placeholder="Use layout title"
                  />
                </label>
                <details>
                  <summary>Customize report sections</summary>
                  <p>
                    Leave unchecked to use the selected layout's defaults.
                    Source evidence is always included.
                  </p>
                  {[
                    "schedule",
                    "issues",
                    "resources",
                    "materials",
                    "productivity",
                    "curve",
                  ].map((k) => (
                    <label className="check" key={k}>
                      <input
                        type="checkbox"
                        checked={reportSections.includes(k)}
                        onChange={(e) =>
                          setReportSections(
                            e.target.checked
                              ? [...reportSections, k]
                              : reportSections.filter((x) => x !== k),
                          )
                        }
                      />
                      {k}
                    </label>
                  ))}
                </details>
              </section>
              <section className="panel">
                {heading(
                  "Project report exports",
                  "PDF and Excel share the same immutable snapshot and selected filters.",
                  <button
                    className="button"
                    onClick={() => void exportReport()}
                  >
                    <Download size={16} /> Generate report
                  </button>,
                )}
                <div className="report-explainer">
                  <FileText size={35} />
                  <div>
                    <h3>Weekly project report</h3>
                    <p>
                      Verified KPIs, milestone dates, open constraints, and
                      calculation evidence. Financial metrics remain unavailable
                      until approved cost inputs exist.
                    </p>
                  </div>
                </div>
                <label className="historical">
                  View records as they existed at
                  <input
                    type="datetime-local"
                    value={asOf}
                    onChange={(e) => setAsOf(e.target.value)}
                  />
                  <small>
                    Historical snapshots start at the project's creation time.
                  </small>
                </label>
                {exports.map((e) => (
                  <div className="list-row" key={e.id}>
                    <span>
                      Snapshot saved {new Date(e.created_at).toLocaleString()}
                    </span>
                    <div className="actions">
                      <a
                        className="button secondary"
                        href={`/api/projects/${projectId}/exports/${e.id}/pdf`}
                      >
                        PDF
                      </a>
                      <a
                        className="button secondary"
                        href={`/api/projects/${projectId}/exports/${e.id}/xlsx`}
                      >
                        Excel
                      </a>
                      <a
                        className="text-button"
                        href={`/api/projects/${projectId}/exports/${e.id}/json`}
                      >
                        JSON
                      </a>
                    </div>
                  </div>
                ))}
              </section>
              {manager && (
                <section className="panel section-spacer">
                  {heading(
                    "Customer publications",
                    "Publish a view-only snapshot. Internal labor, notes and documents are excluded.",
                    button("Publish snapshot", () =>
                      setModal({ type: "publish" }),
                    ),
                  )}
                  {publications.map((p) => (
                    <div className="list-row" key={p.id}>
                      <div>
                        <strong>Published {fmtDate(p.created_at)}</strong>
                        <small>
                          Expires {fmtDate(p.expires_at)} · Link shown once at
                          creation
                        </small>
                      </div>
                      <Badge
                        value={
                          p.revoked
                            ? "revoked"
                            : new Date(p.expires_at) < new Date()
                              ? "expired"
                              : "published"
                        }
                      />
                      {!p.revoked && (
                        <button
                          className="text-button danger"
                          onClick={() => setModal({ type: "revoke", id: p.id })}
                        >
                          Revoke access
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {d && page === "Activity" && (
            <section className="panel">
              {heading(
                "Project audit trail",
                "Who changed each record, when it changed, and the saved source version.",
              )}
              <div className="audit-list">
                {events.map((e) => (
                  <div key={e.seq}>
                    <span className="audit-dot" />
                    <div>
                      <strong>{e.actor_name}</strong>{" "}
                      {e.action.replaceAll("_", " ")} a{" "}
                      {e.entity_kind.replaceAll("_", " ")}
                      <small>
                        {e.entity_id} · version {e.version}
                      </small>
                    </div>
                    <time>{new Date(e.created_at).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            </section>
          )}
          {page === "Settings" && (
            <>
              <section className="panel">
                {heading(
                  "Dashboard layout",
                  "Choose the overview metrics you want to see. Preferences are saved to your account.",
                )}
                <div className="view-options">
                  {[
                    ...new Set([
                      ...views.order,
                      "progress",
                      "actual_hours",
                      "remaining_hours",
                      "schedule_variance",
                      "blockers",
                      "material_ready",
                    ]),
                  ].map((key: any, index, array) => (
                    <div key={key}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!views.hidden.includes(key)}
                          onChange={() =>
                            void saveView({
                              ...views,
                              hidden: views.hidden.includes(key)
                                ? views.hidden.filter((k: string) => k !== key)
                                : [...views.hidden, key],
                            })
                          }
                        />
                        {String(key).replaceAll("_", " ")}
                      </label>
                      <button
                        className="icon-btn"
                        aria-label={`Move ${key} up`}
                        disabled={index === 0}
                        onClick={() => {
                          const a = [...array];
                          [a[index - 1], a[index]] = [a[index], a[index - 1]];
                          void saveView({ ...views, order: a });
                        }}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Move ${key} down`}
                        disabled={index === array.length - 1}
                        onClick={() => {
                          const a = [...array];
                          [a[index + 1], a[index]] = [a[index], a[index + 1]];
                          void saveView({ ...views, order: a });
                        }}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              {manager && (
                <section className="panel section-spacer">
                  {heading(
                    "Project administration",
                    "Project settings, working calendars, and archive controls.",
                  )}
                  <div className="settings-projects">
                    {projects.map((p) => (
                      <div className="list-row" key={p.id}>
                        <div>
                          <strong>{p.data.name}</strong>
                          <small>
                            {p.data.timezone} ·{" "}
                            {p.data.archived ? "Archived" : "Active"}
                          </small>
                        </div>
                        <div className="actions">
                          <button
                            className="button secondary"
                            onClick={() =>
                              setModal({ type: "project", row: p })
                            }
                          >
                            Edit settings
                          </button>
                          <a
                            className="text-button"
                            href={`/api/projects/${p.id}/structure`}
                          >
                            Export setup
                          </a>
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({ type: "template", projectId: p.id })
                            }
                          >
                            Save template
                          </button>
                          <button
                            className="text-button"
                            onClick={async () => {
                              try {
                                await send(
                                  `/projects/${p.id}`,
                                  {
                                    data: {
                                      ...p.data,
                                      archived: !p.data.archived,
                                    },
                                    version: p.version,
                                  },
                                  "PATCH",
                                );
                                await saved();
                              } catch (e) {
                                fail(e);
                              }
                            }}
                          >
                            {p.data.archived ? "Restore" : "Archive"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="actions section-spacer">
                    {button("Create project", createProject)}
                    {user?.role === "admin" &&
                      button(
                        "Load sample project",
                        async () => {
                          try {
                            await send("/sample", {});
                            await saved();
                          } catch (e) {
                            fail(e);
                          }
                        },
                        true,
                      )}
                  </div>
                </section>
              )}
              {manager && (
                <section className="panel section-spacer">
                  {heading(
                    "Project templates",
                    "Reuse sections, tasks and material requirements. Dates, release confirmations and receipts reset for the new project.",
                  )}
                  {templates.length ? (
                    templates.map((t) => (
                      <div className="list-row" key={t.id}>
                        <strong>{t.name}</strong>
                        <button
                          className="button secondary"
                          onClick={() =>
                            setModal({ type: "from-template", id: t.id })
                          }
                        >
                          Create project
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Save a project as a template above.</p>
                  )}
                </section>
              )}
              {user?.role === "admin" && (
                <section className="panel section-spacer">
                  {heading(
                    "Team & access",
                    "Administrators and PMs access all organization projects. Field and purchasing users require project assignments.",
                    button("Add team member", () => setModal({ type: "user" })),
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Role</th>
                          <th>Project access</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <strong>{m.name}</strong>
                              <small>{m.email}</small>
                            </td>
                            <td>{m.role}</td>
                            <td>
                              {["admin", "pm"].includes(m.role)
                                ? "All organization projects"
                                : m.project_ids.length + " assigned"}
                            </td>
                            <td>{m.active ? "Active" : "Disabled"}</td>
                            <td>
                              {m.id !== user.id && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setModal({ type: "user", row: m })
                                  }
                                >
                                  Manage access
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              <section className="panel section-spacer">
                {heading(
                  "Account",
                  "Keep your password private. Changing it ends your other sessions.",
                  <>
                    <button
                      className="button secondary"
                      onClick={() => setModal({ type: "password" })}
                    >
                      Change password
                    </button>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        await send("/auth/logout", {});
                        location.href = "/";
                      }}
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </>,
                )}
              </section>
            </>
          )}
          <footer className="main-footer">
            <span>
              <Layers3 size={14} /> Fieldboard by CAS-TX
            </span>
            <span>Built on records. Ready for decisions.</span>
            <a
              href="https://cas-tx.com/Dashboard"
              target="_blank"
              rel="noreferrer"
            >
              About Fieldboard <ArrowUpRight size={13} />
            </a>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal?.type === "record" && d && (
        <Editor
          title={`${modal.row ? "Edit" : "New"} ${modal.kind === "report" ? "daily report" : modal.kind}`}
          fields={recordFields(modal.kind, d, !!modal.row).map((f) =>
            f.key === "ownerId"
              ? {
                  ...f,
                  options: projectTeam.map((u) => ({
                    value: u.id,
                    label: u.name,
                  })),
                }
              : f.key === "predecessorIds"
                ? {
                    ...f,
                    options: f.options?.filter(
                      (o) => o.value !== modal.row?.id,
                    ),
                  }
                : f,
          )}
          initial={modal.row?.data || recordDefault(modal.kind, d)}
          onClose={() => setModal(null)}
          description={
            modal.kind === "task"
              ? "Enter approved baseline inputs only. Later schedule changes go through revision approval."
              : modal.kind === "report"
                ? "Save a draft or submit for PM approval. Submitted records are locked for review."
                : undefined
          }
          onSave={async (data) => {
            if (modal.kind === "request") {
              const target = [...d.sections, ...d.tasks, ...d.materials].find(
                (r) => r.id === data.targetId,
              );
              data.targetVersion = target?.version || null;
              data.taskId =
                target?.kind === "task" ? target.id : target?.data.taskId || "";
              data.sectionId =
                target?.kind === "section"
                  ? target.id
                  : target?.data.sectionId ||
                    d.tasks.find((t) => t.id === data.taskId)?.data.sectionId ||
                    "";
            }
            await send(
              modal.row
                ? `/projects/${projectId}/records/${modal.row.id}`
                : `/projects/${projectId}/records/${modal.kind}`,
              { data, ...(modal.row ? { version: modal.row.version } : {}) },
              modal.row ? "PATCH" : "POST",
              modal.key,
            );
            await saved();
          }}
        />
      )}
      {modal?.type === "project" && (
        <Editor
          title={modal.row ? "Project settings" : "Create project"}
          fields={[
            ...projectFields.filter(
              (f) =>
                !modal.row ||
                !["baselineFinish", "forecastFinish"].includes(f.key),
            ),
            {
              key: "workDaysText",
              label: "Workdays (0=Sun, 1=Mon … 6=Sat)",
              help: "Comma-separated days. Default: Monday–Friday.",
            },
            {
              key: "holidaysText",
              label: "Non-working holidays",
              help: "Comma-separated ISO dates: YYYY-MM-DD.",
            },
          ]}
          initial={{
            ...projectDefault,
            ...(modal.row?.data || {}),
            workDaysText: (modal.row?.data.workDays || [1, 2, 3, 4, 5]).join(
              ",",
            ),
            holidaysText: (modal.row?.data.holidays || []).join(","),
          }}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            const normalized = {
              ...data,
              workDays: data.workDaysText
                .split(",")
                .filter(Boolean)
                .map(Number),
              holidays: data.holidaysText
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean),
            };
            const p = modal.row
              ? await send(
                  `/projects/${modal.row.id}`,
                  { data: normalized, version: modal.row.version },
                  "PATCH",
                )
              : await send("/projects", normalized);
            if (!modal.row) {
              await send(
                `/projects/${p.id}/records/section`,
                {
                  data: {
                    name: "Section 1",
                    released: false,
                    releaseReference: "",
                  },
                },
                "POST",
                crypto.randomUUID(),
              );
              setProjectId(p.id);
              setSection("");
              navigate("Overview");
            }
            await saved();
          }}
        />
      )}
      {modal?.type === "details" && (
        <RecordDetails
          record={modal.row}
          documents={d?.documents}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "metric" && (
        <Modal
          title={modal.value.metric.label}
          onClose={() => setModal(null)}
          wide
        >
          <div className="metric-detail">
            <strong>
              {moneyless(modal.value.metric.value, modal.value.metric.unit)}
            </strong>
            <Badge
              value={modal.value.metric.missingData ? "incomplete" : "verified"}
            />
          </div>
          <p>{modal.value.metric.coverage}</p>
          <dl className="details">
            <div>
              <dt>Calculation</dt>
              <dd>
                <code>{modal.value.metric.calculation}</code>
              </dd>
            </div>
            <div>
              <dt>As of</dt>
              <dd>{new Date(modal.value.metric.asOf).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Filters</dt>
              <dd>
                <code>{JSON.stringify(modal.value.metric.scope)}</code>
              </dd>
            </div>
          </dl>
          <h3>Source records</h3>
          {modal.value.records.length ? (
            modal.value.records.map((r: any) => (
              <details className="source-details" key={r.id}>
                <summary>
                  {r.data.name || r.data.accomplishments || r.kind} · v
                  {r.version}
                </summary>
                <p className="muted">{r.id}</p>
                <pre>{JSON.stringify(r.data, null, 2)}</pre>
              </details>
            ))
          ) : (
            <p className="muted">
              No approved source records are available for this metric.
            </p>
          )}
        </Modal>
      )}
      {modal?.type === "decision" && (
        <Editor
          title={`${modal.decision === "voided" ? "Void" : modal.decision === "approved" ? "Approve" : "Reject"} ${modal.row.kind}`}
          fields={[
            {
              key: "reason",
              label: "Decision reason / evidence",
              type: "textarea",
              required: true,
            },
          ]}
          initial={{ reason: "" }}
          onClose={() => setModal(null)}
          submit="Record decision"
          onSave={async (data) => {
            const result = await send(
              `/projects/${projectId}/approvals/${modal.row.id}/decision`,
              { ...data, decision: modal.decision, version: modal.row.version },
            );
            await saved();
            if (result.publication) {
              setTimeout(
                () =>
                  setModal({
                    type: "publication-link",
                    url: result.publication.url,
                  }),
                0,
              );
            }
          }}
        />
      )}
      {modal?.type === "publication-link" && (
        <Modal
          title="Approved customer publication"
          onClose={() => setModal(null)}
        >
          <p>Save this link now. Its token is shown once.</p>
          <a href={modal.url}>
            {location.origin}
            {modal.url}
          </a>
        </Modal>
      )}
      {modal?.type === "export" && (
        <Modal title="Your report is ready" onClose={() => setModal(null)}>
          <p>
            Both formats use the same saved project snapshot and selected
            filters.
          </p>
          <div className="actions">
            <a
              className="button"
              href={`/api/projects/${projectId}/exports/${modal.id}/pdf`}
            >
              Download PDF
            </a>
            <a
              className="button secondary"
              href={`/api/projects/${projectId}/exports/${modal.id}/xlsx`}
            >
              Download Excel
            </a>
          </div>
        </Modal>
      )}
      {modal?.type === "publish" && (
        <Editor
          title="Publish a customer snapshot"
          description="Anyone with this link can view the approved snapshot until it expires or you revoke it. Internal labor, notes, documents and pending revisions are excluded."
          fields={[
            {
              key: "days",
              label: "Link lifetime (days)",
              type: "number",
              min: 1,
              max: 90,
              required: true,
            },
          ]}
          initial={{ days: 7 }}
          onClose={() => setModal(null)}
          submit="Publish snapshot"
          onSave={async (data) => {
            const p = await send(endpoint("publications"), data);
            await saved();
            setTimeout(() => setModal({ type: "share", ...p }), 0);
          }}
        />
      )}
      {modal?.type === "share" && (
        <Modal title="Customer report published" onClose={() => setModal(null)}>
          <p>Copy this link now. It is shown only once.</p>
          <label>
            Read-only report link
            <input
              readOnly
              value={location.origin + modal.url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <div className="actions section-spacer">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    location.origin + modal.url,
                  );
                  notify("Link copied");
                } catch {
                  notify("Select and copy the link above");
                }
              }}
            >
              Copy link
            </button>
            <a
              className="button secondary"
              target="_blank"
              rel="noreferrer"
              href={modal.url}
            >
              Open report
            </a>
          </div>
          <p className="muted">Expires {fmtDate(modal.expiresAt)}</p>
        </Modal>
      )}
      {modal?.type === "revoke" && (
        <Editor
          title="Revoke this customer report?"
          description="The existing link will stop working immediately. Saved internal reports will remain available."
          fields={[]}
          initial={{}}
          submit="Revoke access"
          onClose={() => setModal(null)}
          onSave={async () => {
            await api(`/projects/${projectId}/publications/${modal.id}`, {
              method: "DELETE",
            });
            await saved();
          }}
        />
      )}
      {modal?.type === "upload" && (
        <Upload
          projectId={projectId}
          section={section}
          onClose={() => setModal(null)}
          onSave={saved}
        />
      )}
      {modal?.type === "user" && (
        <UserEditor
          row={modal.row}
          projects={projects}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await send(
              modal.row ? `/users/${modal.row.id}` : "/users",
              data,
              modal.row ? "PATCH" : "POST",
            );
            await saved();
          }}
        />
      )}
      {modal?.type === "template" && (
        <Editor
          title="Save project template"
          fields={[{ key: "name", label: "Template name", required: true }]}
          initial={{ name: "" }}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await send(`/projects/${modal.projectId}/template`, data);
            await saved();
          }}
        />
      )}
      {modal?.type === "from-template" && (
        <Editor
          title="Create project from template"
          fields={projectFields.filter((f) =>
            ["name", "code", "customer"].includes(f.key),
          )}
          initial={{ name: "", code: "", customer: "" }}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            const p = await send(`/templates/${modal.id}/projects`, data);
            setProjectId(p.id);
            setSection("");
            navigate("Overview");
            await saved();
          }}
        />
      )}
      {modal?.type === "import" && (
        <ImportProject
          onClose={() => setModal(null)}
          onSave={async (p) => {
            setProjectId(p.id);
            setSection("");
            navigate("Overview");
            await saved();
          }}
        />
      )}
      {modal?.type === "password" && (
        <Editor
          title="Change password"
          fields={[
            {
              key: "currentPassword",
              label: "Current password",
              type: "password",
              required: true,
            },
            {
              key: "newPassword",
              label: "New password (12+ characters)",
              type: "password",
              required: true,
            },
          ]}
          initial={{}}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await send("/password", data);
            notify("Password changed; other sessions ended");
          }}
        />
      )}
    </div>
  );
}
function CrewConflicts({ portfolio }: { portfolio: Dashboard[] }) {
  const all = portfolio
    .filter((d) => !d.project.data.archived)
    .flatMap((d) =>
      d.crew.map((c) => ({ ...c, projectName: d.project.data.name })),
    );
  const conflicts: any[] = [];
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++) {
      const x = all[a],
        y = all[b];
      if (
        x.project_id !== y.project_id &&
        (x.data.name.trim().toLowerCase() ===
          y.data.name.trim().toLowerCase() ||
          (x.data.memberIds || []).some((id: string) =>
            (y.data.memberIds || []).includes(id),
          )) &&
        x.data.start <= y.data.end &&
        y.data.start <= x.data.end
      )
        conflicts.push([x, y]);
    }
  return conflicts.length ? (
    <div>
      {conflicts.map(([x, y], i) => (
        <div key={i} className="notice amber">
          <TriangleAlert size={16} />
          {x.data.name}: {x.projectName} overlaps {y.projectName}
        </div>
      ))}
    </div>
  ) : (
    <p className="muted">
      No overlapping assignments found in accessible projects.
    </p>
  );
}
function Upload({
  projectId,
  section,
  onClose,
  onSave,
}: {
  projectId: string;
  section: string;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Upload project evidence" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const form = new FormData(e.currentTarget);
            form.set("sectionId", section);
            await api(`/projects/${projectId}/documents`, {
              method: "POST",
              body: form,
            });
            await onSave();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Document name
          <input name="name" required />
        </label>
        <label>
          Reference / description
          <textarea name="reference" />
        </label>
        <label>
          PDF or image
          <input
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            required
          />
        </label>
        <p className="muted">
          Files stay quarantined until the server's configured malware scanner
          clears them.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button" disabled={busy}>
            {busy ? "Uploading…" : "Upload evidence"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function UserEditor({
  row,
  projects,
  onClose,
  onSave,
}: {
  row: any;
  projects: Project[];
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const fields: Field[] = [
    ...(row
      ? []
      : [
          { key: "name", label: "Name", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          {
            key: "password",
            label: "Initial password (12+ characters)",
            type: "password",
            required: true,
          },
        ]),
    {
      key: "role",
      label: "Role",
      type: "select",
      required: true,
      options: [
        "admin",
        "pm",
        "foreman",
        "purchasing",
        "accountant",
        "viewer",
      ].map((r) => ({
        value: r,
        label: r,
      })),
    },
    ...projects.map((p) => ({
      key: `project_${p.id}`,
      label: p.data.name,
      type: "checkbox",
    })),
    ...(row
      ? [{ key: "active", label: "Account active", type: "checkbox" }]
      : []),
  ];
  return (
    <Editor
      title={row ? "Manage team access" : "Add team member"}
      fields={fields}
      initial={{
        role: row?.role || "foreman",
        active: row?.active ?? true,
        ...Object.fromEntries(
          projects.map((p) => [
            `project_${p.id}`,
            row?.project_ids.includes(p.id) || false,
          ]),
        ),
      }}
      description="Viewers can only open published report links. Share initial passwords through a private channel; each member can change their password after sign-in."
      onClose={onClose}
      onSave={async (data) =>
        onSave({
          ...data,
          projectIds: projects
            .filter((p) => data[`project_${p.id}`])
            .map((p) => p.id),
        })
      }
    />
  );
}
function ImportProject({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (p: Project) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Import project setup" onClose={onClose}>
      <p>
        Import a Fieldboard schemaVersion 1 JSON file. The setup contains
        sections, approved baseline inputs and task requirements. Actual work
        and receipts must be recorded and approved separately.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const file = new FormData(e.currentTarget).get("file") as File;
            if (file.size > 900000)
              throw new Error("Setup file must be smaller than 900 KB");
            const data = JSON.parse(await file.text());
            const p = await send("/import", data);
            await onSave(p);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project setup file
          <input
            type="file"
            name="file"
            accept=".json,application/json"
            required
          />
        </label>
        <label className="check">
          <input type="checkbox" required />I have reviewed and approved the
          baseline inputs in this file.
        </label>
        {error && <p className="error">{error}</p>}
        <button className="button" disabled={busy}>
          {busy ? "Importing…" : "Import as new project"}
        </button>
      </form>
    </Modal>
  );
}
export default App;
