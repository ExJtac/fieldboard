import { useState } from "react";
import { ArrowUpRight, Check, Layers3 } from "lucide-react";
import { send, fmtDate, moneyless } from "./api";
export function Auth({
  setup,
  oidcEnabled,
  signupEnabled,
  tokenRequired,
  onDone,
}: {
  setup: boolean;
  oidcEnabled?: boolean;
  signupEnabled?: boolean;
  tokenRequired: boolean;
  onDone: () => void;
}) {
  const [register, setRegister] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <section className="auth-story">
        <a className="brand" href="https://cas-tx.com/Dashboard">
          <Layers3 /> fieldboard<span>BY CAS-TX</span>
        </a>
        <div>
          <p className="eyebrow">BUILT FOR THE WORK AHEAD</p>
          <h1>
            A clearer picture.
            <br />A better day
            <br />
            <em>on site.</em>
          </h1>
          <p>
            Your schedule, people, materials and next decisions. One shared
            view, grounded in the records behind the work.
          </p>
          <div className="auth-points">
            <span>
              <Check size={16} /> Open source
            </span>
            <span>
              <Check size={16} /> Your data
            </span>
            <span>
              <Check size={16} /> Self-hosted
            </span>
          </div>
        </div>
        <p className="auth-foot">
          Construction project control · Made by CAS-TX{" "}
          <ArrowUpRight size={18} />
        </p>
      </section>
      <section className="auth-form">
        <div>
          <p className="eyebrow">FIELDBOARD / WORKSPACE</p>
          {oidcEnabled && !setup && (
            <a className="button secondary" href="/api/auth/oidc/start">
              Sign in with your organization
            </a>
          )}
          <h2>
            {setup || register ? "Make room for better work." : "Welcome back."}
          </h2>
          <p className="muted">
            {setup
              ? "Create your organization and the first administrator account."
              : "Sign in to your project workspace."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const result = await send(
                  setup
                    ? "/auth/setup"
                    : register
                      ? "/auth/register"
                      : "/auth/login",
                  {
                    ...data,
                    sample: data.sample === "on",
                  },
                );
                if (register) {
                  setMessage(result.message);
                  return;
                }
                onDone();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {(setup || register) && (
              <>
                <label>
                  Your name
                  <input name="name" autoComplete="name" required />
                </label>
                <label>
                  Organization
                  <input
                    name="organization"
                    autoComplete="organization"
                    required
                  />
                </label>
              </>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  setup || register ? "new-password" : "current-password"
                }
                minLength={12}
                required
              />
              <small>At least 12 characters.</small>
            </label>
            {setup && tokenRequired && (
              <label>
                Installation setup token
                <input name="setupToken" type="password" required />
              </label>
            )}
            {setup && (
              <label className="check">
                <input name="sample" type="checkbox" defaultChecked /> Include
                the clearly labeled construction sample project
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button" disabled={busy}>
              {busy
                ? "One moment…"
                : register
                  ? "Send verification link"
                  : setup
                    ? "Create workspace"
                    : "Sign in"}
              <ArrowUpRight size={17} />
            </button>
          </form>
          {message && <p role="status">{message}</p>}
          {signupEnabled && !setup && (
            <button
              className="button secondary"
              onClick={() => {
                setRegister(!register);
                setMessage("");
                setError("");
              }}
            >
              {register ? "Back to sign in" : "Create a workspace"}
            </button>
          )}
          <p className="fine-print">
            MIT licensed. Self-hosted dashboard features are free; hosted
            workspace plans are managed by your provider.
          </p>
        </div>
      </section>
    </div>
  );
}
export function SharedReport({ data, error }: { data: any; error: string }) {
  return (
    <main className="shared">
      <a className="brand dark" href="/">
        fieldboard<span>BY CAS-TX</span>
      </a>
      {error ? (
        <div className="empty">
          <h1>Report unavailable</h1>
          <p>{error}</p>
        </div>
      ) : !data ? (
        <p>Loading publication…</p>
      ) : (
        <>
          <p className="eyebrow">
            {data.snapshot.organization} / PUBLISHED PROJECT REPORT
          </p>
          <h1>{data.snapshot.project.name}</h1>
          <p>
            {data.snapshot.project.customer} · {data.snapshot.project.phase}
          </p>
          {data.snapshot.project.sample && (
            <p className="notice">Sample project · illustrative fixture</p>
          )}
          <p className="muted">
            Published snapshot {new Date(data.snapshot.asOf).toLocaleString()} ·
            Expires {fmtDate(data.expires_at)}
          </p>
          <div className="kpi-grid">
            {data.snapshot.metrics.map((m: any) => (
              <article className="kpi" key={m.key}>
                <span>{m.label}</span>
                <strong>{moneyless(m.value, m.unit)}</strong>
                <small>{m.coverage}</small>
              </article>
            ))}
          </div>
          <section className="panel">
            <h2>Published milestones</h2>
            {!data.snapshot.milestones.length ? (
              <p>No milestones included.</p>
            ) : (
              data.snapshot.milestones.map((m: any, i: number) => (
                <div className="list-row" key={i}>
                  <strong>{m.name}</strong>
                  <span>
                    Baseline {fmtDate(m.baselineFinish)} · Forecast{" "}
                    {fmtDate(m.forecastFinish)}
                  </span>
                </div>
              ))
            )}
          </section>
          <p className="muted">{data.snapshot.notice}</p>
        </>
      )}
    </main>
  );
}
