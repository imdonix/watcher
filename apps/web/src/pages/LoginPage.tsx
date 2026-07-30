import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Radar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/80 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Radar className="h-7 w-7" />
          </div>
          <div>
            <CardTitle className="text-2xl tracking-tight">Watcher</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Sign in with your API token</p>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">API token</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="token"
                  type={show ? "text" : "password"}
                  value={token}
                  onChange={(e) => setTokenValue(e.target.value)}
                  required
                  autoComplete="current-password"
                  spellCheck={false}
                  autoFocus
                  className="h-12 rounded-xl pl-9 pr-11 font-mono text-sm"
                  placeholder="paste token…"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setShow((s) => !s)}
                  tabIndex={-1}
                  aria-label={show ? "Hide token" : "Show token"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="h-12 w-full rounded-xl text-base"
              disabled={busy || !token.trim()}
            >
              {busy ? "Checking…" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
