/** Single-line updating progress bar utility */
export class ProgressBar {
    private startTime: number;
    private lastUpdate: number = 0;

    constructor(
        private total: number,
        private label: string
    ) {
        this.startTime = Date.now();
    }

    update(current: number, extraInfo?: string): void {
        const now = Date.now();
        // Update max every 500ms to avoid flickering
        if (now - this.lastUpdate < 500 && current < this.total) return;
        this.lastUpdate = now;

        const percent = Math.min(100, (current / this.total) * 100);
        const elapsed = (now - this.startTime) / 1000;
        const rate = current / elapsed;
        const remaining = this.total - current;
        const eta = remaining / rate;

        // Progress bar
        const barWidth = 30;
        const filled = Math.floor((percent / 100) * barWidth);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

        // Format time
        const formatTime = (seconds: number) => {
            if (!isFinite(seconds)) return '--:--';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const info = extraInfo ? ` | ${extraInfo}` : '';
        const line = `\r${this.label}: [${bar}] ${percent.toFixed(1)}% | ${current}/${this.total} | ETA: ${formatTime(eta)}${info}`;

        process.stdout.write(line);

        if (current >= this.total) {
            process.stdout.write('\n');
        }
    }

    finish(message?: string): void {
        if (message) {
            process.stdout.write(`\r${' '.repeat(100)}\r`); // Clear line
            console.log(message);
        } else {
            process.stdout.write('\n');
        }
    }
}
