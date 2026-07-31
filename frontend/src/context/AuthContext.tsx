import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DemoUser } from "../api/client";

interface AuthContextValue {
  users: DemoUser[];
  currentUser: DemoUser | null;
  isLoading: boolean;
  login: (userId: string) => void;
  logout: () => void;
  hasRole: (roleType: string, departmentId?: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem("demoUserId"));

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const currentUser = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  useEffect(() => {
    // If the previously selected demo user no longer exists, clear it.
    if (!isLoading && userId && !currentUser) {
      localStorage.removeItem("demoUserId");
      setUserId(null);
    }
  }, [isLoading, userId, currentUser]);

  const login = (id: string) => {
    localStorage.setItem("demoUserId", id);
    setUserId(id);
  };

  const logout = () => {
    localStorage.removeItem("demoUserId");
    setUserId(null);
  };

  const hasRole = (roleType: string, departmentId?: string) =>
    currentUser?.roles.some((r) => r.roleType === roleType && (!departmentId || r.department.id === departmentId)) ??
    false;

  return (
    <AuthContext.Provider value={{ users, currentUser, isLoading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
