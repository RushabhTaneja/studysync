import type { ReactNode } from "react";
import { useAuth } from "../auth";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <>
      <div className="topbar">
        <div className="brand">
          StudySync <small>Wearable Data Platform</small>
        </div>
        <div className="right">
          {user && (
            <>
              <span>
                {user.displayName}
                <span className="muted"> · {user.role}</span>
                {user.participantCode ? <span className="muted"> · {user.participantCode}</span> : null}
              </span>
              <button onClick={logout}>Sign out</button>
            </>
          )}
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  );
}
