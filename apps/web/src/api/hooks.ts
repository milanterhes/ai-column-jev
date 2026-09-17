import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type DatasetDetail, type DatasetSummary, type ResultDto } from "./client.ts"

export const datasetsQueryKey = ["datasets"] as const

export const useDatasets = (enabled = true) =>
  useQuery<DatasetSummary[]>({
    queryKey: datasetsQueryKey,
    queryFn: api.listDatasets,
    enabled
  })

export const datasetQueryKey = (datasetId: string) => ["dataset", datasetId] as const

export const useDataset = (datasetId: string) =>
  useQuery<DatasetDetail>({
    queryKey: datasetQueryKey(datasetId),
    queryFn: () => api.getDataset(datasetId)
  })

export const resultsQueryKey = (datasetId: string, columnIds: string[]) =>
  ["results", datasetId, columnIds.join(",")] as const

export const useResults = (datasetId: string, columnIds: string[], poll: boolean) =>
  useQuery<Record<string, ResultDto[]>>({
    queryKey: resultsQueryKey(datasetId, columnIds),
    queryFn: async () => {
      const entries = await Promise.all(
        columnIds.map(async (id) => [id, await api.getResults(datasetId, id)] as const)
      )
      return Object.fromEntries(entries)
    },
    enabled: columnIds.length > 0,
    refetchInterval: poll ? 2000 : false
  })

export const useRefreshDataset = (datasetId: string) => {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] })
    void queryClient.invalidateQueries({ queryKey: ["results", datasetId] })
    void queryClient.invalidateQueries({ queryKey: datasetsQueryKey })
  }, [queryClient, datasetId])
}
