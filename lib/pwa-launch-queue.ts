"use client";

type LaunchParams = { targetURL?: string };
type LaunchHandler = (targetURL: string) => boolean;

declare global {
  interface Window {
    launchQueue?: {
      setConsumer: (consumer: (launchParams: LaunchParams) => void) => void;
    };
  }
}

const handlers = new Set<LaunchHandler>();
const pending: string[] = [];
let installedQueue: Window['launchQueue'];

function dispatch(targetURL: string): boolean {
  for (const handler of handlers) {
    if (handler(targetURL)) return true;
  }
  return false;
}

function installConsumer(): void {
  if (typeof window === "undefined" || !window.launchQueue || installedQueue === window.launchQueue) return;
  installedQueue = window.launchQueue;
  installedQueue.setConsumer(({ targetURL }) => {
    if (targetURL && !dispatch(targetURL)) pending.push(targetURL);
  });
}

export function subscribeToPwaLaunches(handler: LaunchHandler): () => void {
  handlers.add(handler);
  installConsumer();

  const unmatched: string[] = [];
  for (const targetURL of pending) {
    if (!handler(targetURL)) unmatched.push(targetURL);
  }
  pending.splice(0, pending.length, ...unmatched);

  return () => handlers.delete(handler);
}
