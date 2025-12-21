/** Progress tracker for visual feedback */
export class ProgressTracker {
  private enabled: boolean;
  private total: number;
  private current: number;
  private label: string;
  private lastUpdate: number;

  constructor(total: number, label: string, enabled = true) {
    this.total = total;
    this.current = 0;
    this.label = label;
    this.enabled = enabled;
    this.lastUpdate = 0;
  }

  /** Update progress */
  update(current: number): void {
    if (!this.enabled) return;

    this.current = current;
    const now = Date.now();

    // Throttle updates to every 100ms
    if (now - this.lastUpdate < 100 && current < this.total) {
      return;
    }

    this.lastUpdate = now;
    this.render();
  }

  /** Increment progress by 1 */
  increment(): void {
    this.update(this.current + 1);
  }

  /** Render progress bar */
  private render(): void {
    const percentage = Math.min(100, Math.floor((this.current / this.total) * 100));
    const barLength = 40;
    const filledLength = Math.floor((percentage / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    // Clear line and write progress
    process.stdout.write(`\r${this.label}: [${bar}] ${percentage}%`);

    // Add newline when complete
    if (this.current >= this.total) {
      process.stdout.write('\n');
    }
  }

  /** Complete progress */
  complete(): void {
    this.update(this.total);
  }

  /** Create a simple text progress (no bar) */
  static simple(current: number, total: number, label: string, enabled = true): void {
    if (!enabled) return;
    const percentage = Math.floor((current / total) * 100);
    process.stdout.write(`\r${label}: ${percentage}%`);
    if (current >= total) {
      process.stdout.write('\n');
    }
  }
}
