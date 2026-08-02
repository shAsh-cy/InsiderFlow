"use client";

import { createContext, useContext } from "react";

import { useWatchlistSession } from "@/hooks/use-watchlist";

export interface SessionInfo {
  userId: string | null;
  email: string | null;
  authConfigured: boolean;
}

const SessionContext = createContext<SessionInfo>({
  userId: null,
  email: null,
  authConfigured: false,
});

export const useSession = (): SessionInfo => useContext(SessionContext);

/**
 * Publishes the server-resolved session to client components and installs
 * the account-backed watchlist store when signed in.
 */
export function SessionProvider({
  session,
  children,
}: {
  session: SessionInfo;
  children: React.ReactNode;
}) {
  useWatchlistSession(session.userId);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
