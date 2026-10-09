import type { ChildProcess } from "node:child_process";

/** Failure cleanup only. Successful scenarios must prove natural process exit. */
export async function stopOwnedTestChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let close!: () => void;
  const closed = new Promise<true>((done) => { close = () => done(true); });
  child.once("close", close);
  const wait = async (timeout: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([closed, new Promise<false>((done) => { timer = setTimeout(() => done(false), timeout); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    child.kill("SIGTERM");
    if (await wait(2_000)) return;
    // Exact retained ChildProcess handle, never a PID search or broad kill.
    child.kill("SIGKILL");
    if (!await wait(5_000)) throw new Error("SYNTHETIC_OWNED_CHILD_CLEANUP_TIMEOUT");
  } finally { child.removeListener("close", close); }
}
