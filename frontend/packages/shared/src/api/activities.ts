import type { Activity, ActivityInput, FeedResponse, UpdateActivityInput } from "../types";
import type { RawClient } from "./client";

export function createActivityApi(api: RawClient) {
  return {
    create: (userId: string, input: ActivityInput) =>
      api.post<Activity>(`/users/${userId}/outbox`, input),

    list: (userId: string) =>
      api.get<FeedResponse>(`/users/${userId}/outbox`),

    update: (userId: string, activityId: string, input: UpdateActivityInput) =>
      api.patch<Activity>(`/users/${userId}/activities/${activityId}`, input),

    remove: (userId: string, activityId: string) =>
      api.del<{ status: string }>(`/users/${userId}/activities/${activityId}`),

    feed: (userId: string) =>
      api.get<FeedResponse>(`/users/${userId}/feed`),

    like: (userId: string, objectUri: string) =>
      api.post<Activity>(`/users/${userId}/likes`, { object: objectUri }),

    unlike: (userId: string, objectUri: string) =>
      api.del<{ status: string }>(`/users/${userId}/likes`, { object: objectUri }),

    announce: (userId: string, objectUri: string) =>
      api.post<Activity>(`/users/${userId}/announces`, { object: objectUri }),

    unannounce: (userId: string, objectUri: string) =>
      api.del<{ status: string }>(`/users/${userId}/announces`, { object: objectUri }),

    undo: (userId: string, objectType: string, objectUri: string) =>
      api.post<Activity>(`/users/${userId}/outbox`, {
        type: "Undo",
        objectType,
        object: objectUri,
      }),

    liked: (userId: string) =>
      api.get<FeedResponse>(`/users/${userId}/liked`),

    mentions: (userId: string) =>
      api.get<FeedResponse>(`/users/${userId}/mentions`),
  };
}
