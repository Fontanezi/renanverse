import { createClient, type RawClient } from "./client";
import { createUserApi } from "./users";
import { createActivityApi } from "./activities";

export interface ApiClient {
  client: RawClient;
  users: ReturnType<typeof createUserApi>;
  activities: ReturnType<typeof createActivityApi>;
}

export function createApi(baseUrl: string): ApiClient {
  const client = createClient(baseUrl);
  return {
    client,
    users: createUserApi(client),
    activities: createActivityApi(client),
  };
}
