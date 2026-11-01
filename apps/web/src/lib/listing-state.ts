import type { ListingState } from "@watcher/shared";

type StateFields = {
  state?: ListingState;
  status?: string;
  notInterested?: boolean;
  notInterestedReason?: "user" | "ai" | null;
};

/** API normally provides state; derive it for older cached payloads. */
export function listingStateOf(item: StateFields): ListingState {
  if (item.state) return item.state;
  if (item.status === "deleted") return "deleted";
  if (item.notInterested) {
    return item.notInterestedReason === "ai" ? "ruled_out" : "not_interested";
  }
  if (item.status === "missing") return "missing";
  return "interesting";
}

export function listingStateLabel(state: ListingState): string {
  switch (state) {
    case "deleted":
      return "Deleted";
    case "missing":
      return "Missing from search";
    case "not_interested":
      return "Not interested";
    case "ruled_out":
      return "Ruled out";
    default:
      return "Interesting";
  }
}
