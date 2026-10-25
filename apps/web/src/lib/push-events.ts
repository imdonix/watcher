/** Fired after this device's push subscription changes. */
export const PUSH_STATE_EVENT = "watcher:push-state";

export function notifyPushStateChanged() {
  window.dispatchEvent(new Event(PUSH_STATE_EVENT));
}
