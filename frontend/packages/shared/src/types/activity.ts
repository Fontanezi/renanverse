export interface ActivityObject {
  type: string;
  id?: string;
  content?: string;
  title?: string;
  attachmentUrl?: string;
  attachment?: string;
  attributedTo?: string;
  tag?: { type: "Mention"; href: string }[];
  url?: string;
  inReplyTo?: string;
}

export interface Activity {
  "@context"?: string[];
  type: "Create" | "Update" | "Delete" | "Follow" | "Like" | "Announce" | "Undo";
  id?: string;
  actor: string;
  object: ActivityObject;
  published?: string;
  to?: string[];
}

export interface ActivityInput {
  type?: "Create" | "Like" | "Announce";
  objectType?: string;
  content?: string;
  title?: string;
  attachmentUrl?: string;
  inReplyTo?: string;
  community?: string;
  altText?: string;
  filter?: string;
}

export interface FeedResponse {
  "@context": string;
  type: "OrderedCollection";
  totalItems: number;
  orderedItems: Activity[];
}

export interface UpdateActivityInput {
  content?: string;
  title?: string;
  attachmentUrl?: string;
}
