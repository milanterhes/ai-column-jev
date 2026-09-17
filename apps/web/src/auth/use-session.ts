import { useQuery } from "@tanstack/react-query"
import { getSession, type Session } from "./client.ts"

export const sessionQueryKey = ["session"] as const

export const useSession = () =>
  useQuery<Session | null>({
    queryKey: sessionQueryKey,
    queryFn: getSession,
    retry: false,
    staleTime: 30_000
  })
