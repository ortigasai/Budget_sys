import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AUTH_TOKEN_KEY, AUTH_USER_ID_KEY, api, setAuthToken, type DemoUser } from "../api/client";

interface AuthContextValue {
  users: DemoUser[];
  currentUser: DemoUser | null;
  isLoading: boolean;
  login: (userId: string, token: string) => void;
  logout: () => void;
  hasRole: (roleType: string, departmentId?: string) => boolean;
  // Separate from hasRole rather than widening its signature, since Phase
  // 3's BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER are scoped by Sbu instead
  // of Department - avoids touching every existing hasRole call site.
  hasSbuRole: (roleType: string, sbu?: string) => boolean;
  // Group-based visibility (User Management workbook): a grouped user's
  // access map is authoritative; an ungrouped one falls back to `legacy`.
  gate: (key: string, legacy: boolean) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Persisted to localStorage (see api/client.ts) so a browser refresh
  // stays logged in on the same page - lazy initializer reads it
  // synchronously on first render, no flash of the login screen while
  // waiting on an effect.
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(AUTH_USER_ID_KEY));

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const currentUser = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  useEffect(() => {
    // If the previously selected demo user no longer exists, clear it.
    if (!isLoading && userId && !currentUser) {
      logout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId, currentUser]);

  const login = (id: string, token: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_ID_KEY, id);
    setAuthToken(token);
    setUserId(id);
  };

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_ID_KEY);
    setAuthToken(null);
    setUserId(null);
  };

  const hasRole = (roleType: string, departmentId?: string) =>
    currentUser?.roles.some((r) => r.roleType === roleType && (!departmentId || r.department?.id === departmentId)) ??
    false;

  const hasSbuRole = (roleType: string, sbu?: string) =>
    currentUser?.roles.some((r) => r.roleType === roleType && (!sbu || r.sbu === sbu)) ?? false;

  const gate = (key: string, legacy: boolean) => (currentUser?.access ? !!currentUser.access[key] : legacy);

  return (
    <AuthContext.Provider value={{ users, currentUser, isLoading, login, logout, hasRole, hasSbuRole, gate }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
