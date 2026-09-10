import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, setAuthToken, type DemoUser } from "../api/client";

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Not persisted: every fresh load of the app lands on the login screen,
  // even if someone logged in during an earlier visit. Login only survives
  // in-session client-side navigation, not a reload.
  const [userId, setUserId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const currentUser = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  useEffect(() => {
    // If the previously selected demo user no longer exists, clear it.
    if (!isLoading && userId && !currentUser) {
      setAuthToken(null);
      setUserId(null);
    }
  }, [isLoading, userId, currentUser]);

  const login = (id: string, token: string) => {
    setAuthToken(token);
    setUserId(id);
  };

  const logout = () => {
    setAuthToken(null);
    setUserId(null);
  };

  const hasRole = (roleType: string, departmentId?: string) =>
    currentUser?.roles.some((r) => r.roleType === roleType && (!departmentId || r.department?.id === departmentId)) ??
    false;

  const hasSbuRole = (roleType: string, sbu?: string) =>
    currentUser?.roles.some((r) => r.roleType === roleType && (!sbu || r.sbu === sbu)) ?? false;

  return (
    <AuthContext.Provider value={{ users, currentUser, isLoading, login, logout, hasRole, hasSbuRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
