import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import client from "../api/client";

export function useGet(queryKey, url, params = {}, options = {}) {
  return useQuery({
    queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
    queryFn: async () => {
      const { data } = await client.get(url, { params });
      return data;
    },
    ...options
  });
}

export function usePost(url) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => client.post(url, body).then((r) => r.data),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || "Error");
    }
  });
}

export function usePut(url) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.put(`${url}${id ? `/${id}` : ""}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || "Error");
    }
  });
}

export function useDelete(url) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      client.delete(`${url}${id ? `/${id}` : ""}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || "Error");
    }
  });
}
