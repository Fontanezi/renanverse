import type { Person, CreatePersonInput } from "../types";
import type { RawClient } from "./client";

export function createUserApi(api: RawClient) {
  return {
    create: (input: CreatePersonInput) =>
      api.post<Person>("/users", input),

    get: (id: string) =>
      api.get<Person>(`/users/${id}`),

    follow: (userId: string, target: { actorUri?: string; handle?: string }) =>
      api.post<{ status: string }>(`/users/${userId}/following`, target),

    unfollow: (userId: string, target: { actorUri: string }) =>
      api.del<{ status: string }>(`/users/${userId}/following`, target),

    removeFollower: (userId: string, target: { actorUri: string }) =>
      api.del<{ status: string }>(`/users/${userId}/followers`, target),

    getFollowing: (userId: string) =>
      api.get<{ items: string[] }>(`/users/${userId}/following`),

    getFollowers: (userId: string) =>
      api.get<{ items: string[] }>(`/users/${userId}/followers`),
  };
}
