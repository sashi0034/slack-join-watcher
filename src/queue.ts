type Task = () => Promise<void>;

/**
 * Serial task queue that waits at least `delayMs` between consecutive task
 * completions. Used to keep `chat.postMessage` and friends well under Slack's
 * Tier-3/4 rate limits when many events arrive in a burst.
 */
export class RateLimitedQueue {
  private readonly tasks: Task[] = [];
  private running = false;

  constructor(private readonly delayMs: number) {}

  enqueue(task: Task): void {
    this.tasks.push(task);
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift()!;
        try {
          await task();
        } catch (err) {
          console.error('[queue] task threw:', err);
        }
        if (this.tasks.length > 0) {
          await sleep(this.delayMs);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
