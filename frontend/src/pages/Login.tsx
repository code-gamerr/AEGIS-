import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { Btn, LogoMark } from "../components/ui";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (error) document.getElementById("login-err")?.focus();
  }, [error]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      nav("/command");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  const field =
    "mt-1 w-full rounded-sm border border-line bg-panel px-3 py-2.5 font-mono text-sm text-paper";

  return (
    <div className="relative grid min-h-dvh bg-ink lg:grid-cols-[1.1fr_0.9fr]">
      <div className="console-grain" aria-hidden />
      <section className="relative z-10 flex flex-col justify-between border-b border-line p-8 lg:border-b-0 lg:border-r lg:p-12">
        <Link to="/" className="flex items-center gap-2 text-paper">
          <LogoMark />
          <span className="display text-[1.15rem]">AEGIS</span>
        </Link>
        <div className="max-w-lg">
          <p className="kicker">Operator access</p>
          <h1 className="display mt-4 max-w-[13ch] text-balance text-[clamp(2.2rem,5vw,4.2rem)]">
            Detect the drift. Propose the move.
          </h1>
          <p className="mt-5 max-w-[42ch] text-pretty text-mute">
            Isolation Forest scores infrastructure telemetry. A tabular Blue policy proposes isolate,
            restore, decoy, or monitor. High-impact actions stay with the operator.
          </p>
        </div>
        <p className="kicker">Local-first · no vendor plane · abstract range only</p>
      </section>
      <section className="relative z-10 flex items-center justify-center p-8">
        <form
          className="w-full max-w-sm"
          onSubmit={onSubmit}
          aria-describedby={error ? "login-err" : undefined}
          aria-busy={pending}
        >
          <p className="kicker">01 / Console</p>
          <h2 className="display mt-3 text-3xl">Operator sign in</h2>
          <label className="kicker mt-8 block" htmlFor="user">
            Username
          </label>
          <input
            id="user"
            className={field}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            aria-invalid={!!error}
            required
          />
          <label className="kicker mt-5 block" htmlFor="pass">
            Password
          </label>
          <input
            id="pass"
            type="password"
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={!!error}
            required
          />
          {error ? (
            <p id="login-err" tabIndex={-1} className="mt-3 text-sm text-bad" role="alert">
              {error}
            </p>
          ) : null}
          <Btn variant="primary" className="mt-8 w-full" disabled={pending}>
            {pending ? "Signing in…" : "Enter console"}
          </Btn>
        </form>
      </section>
    </div>
  );
}
