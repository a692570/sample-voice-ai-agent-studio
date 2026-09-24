// Simple event to notify sidebar that agents list changed
const AGENT_CHANGED_EVENT = 'agent-list-changed';

export function notifyAgentListChanged() {
  window.dispatchEvent(new Event(AGENT_CHANGED_EVENT));
}

export function onAgentListChanged(callback: () => void) {
  window.addEventListener(AGENT_CHANGED_EVENT, callback);
  return () => window.removeEventListener(AGENT_CHANGED_EVENT, callback);
}
