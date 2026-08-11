/** Injectable clock so time-based logic (expiry, reconciliation) is testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  constructor(private t: Date) {}
  now(): Date {
    return this.t;
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
  set(t: Date): void {
    this.t = t;
  }
}
