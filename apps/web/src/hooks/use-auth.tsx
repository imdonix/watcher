import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, setToken } from "@/lib/api";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  login: (apiToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(() => setAuthenticated(true))
      .catch((err) => {
        // Only a rejected token logs the user out. A transient network error
        // (very common when iOS resumes a suspended PWA) must not wipe the
        // saved token and bounce the user to the login screen.
        if (err instanceof Error && err.message === "Unauthorized") {
          setToken(null);
          setAuthenticated(false);
        } else {
          setAuthenticated(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (apiToken: string) => {
    const res = await api.login(apiToken);
    setToken(res.token);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ authenticated, loading, login, logout }),
    [authenticated, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
