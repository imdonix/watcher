import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const { authenticated, loading, login } = useAuth();
  const [token, setTokenValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && authenticated) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(token.trim());
      toast.success("Welcome back");
    } catch {
      toast.error("Invalid API token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-backdrop relative flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="absolute right-3 top-3 sm:right-4 sm:top-4" style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}>
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Brand tagline />
        </div>

        <Card className="shadow-card-hover">
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-xl tracking-tight">Sign in</CardTitle>
            <CardDescription>
              Enter the API token from the Watcher API logs to open your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token">API token</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="token"
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => setTokenValue(e.target.value)}
                    required
                    autoComplete="current-password"
                    spellCheck={false}
                    autoFocus
                    className="h-11 pl-8 pr-10 font-mono text-sm"
                    placeholder="Paste your token…"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => setShow((s) => !s)}
                    tabIndex={-1}
                    aria-label={show ? "Hide token" : "Show token"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={busy || !token.trim()}
              >
                {busy ? "Checking…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          The token is stored only in this browser.
        </p>
      </div>
    </div>
  );
}
