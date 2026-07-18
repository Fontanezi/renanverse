export interface Person {
  "@context": string[];
  type: "Person";
  id: string;
  preferredUsername: string;
  name: string;
  summary?: string;
  inbox: string;
  outbox: string;
  followers: string;
  following: string;
  icon?: string[];
  publicKey: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
}

export interface CreatePersonInput {
  preferredUsername: string;
  name: string;
  summary?: string;
  icon?: string[];
}
