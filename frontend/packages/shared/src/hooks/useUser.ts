import { useState, useCallback } from "react";
import type { Person, CreatePersonInput } from "../types";
import type { RawClient } from "../api/client";

export function useUser(api: RawClient) {
  const [user, setUser] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);

  const createUser = useCallback(async (input: CreatePersonInput) => {
    setLoading(true);
    try {
      const person = await api.post<Person>("/users", input);
      setUser(person);
      return person;
    } finally {
      setLoading(false);
    }
  }, [api]);

  const fetchUser = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const person = await api.get<Person>(`/users/${id}`);
      setUser(person);
      return person;
    } finally {
      setLoading(false);
    }
  }, [api]);

  return { user, loading, createUser, fetchUser, setUser };
}
