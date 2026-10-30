import { useState, useEffect, useCallback } from "react";
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from "aws-amplify/auth";
import { useNavigate } from "react-router-dom";

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function loadAuth() {
      try {
        const currentUser = await getCurrentUser();
        const session = await fetchAuthSession();
        const payload = session.tokens?.idToken?.payload;
        const groups = payload?.["cognito:groups"] ?? [];

        if (!cancelled) {
          setUser(currentUser);
          setRoles(Array.isArray(groups) ? groups : [groups]);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setRoles([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadAuth();
    return () => { cancelled = true; };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await amplifySignOut();
    } finally {
      setUser(null);
      setRoles([]);
      navigate("/login");
    }
  }, [navigate]);

  return {
    user,
    roles,
    isAdmin: roles.includes("admin"),
    isManager: roles.includes("manager") || roles.includes("admin"),
    isLoading,
    signOut
  };
}
