/** Time is injected everywhere (docs/10 section 4). All values are unix seconds. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};

/** Test clock: starts at `start` and only moves when told to. */
export class ManualClock implements Clock {
  constructor(private t: number) {}

  now(): number {
    return this.t;
  }

  advance(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds < 0)
      throw new Error("advance needs a non-negative integer");
    this.t += seconds;
  }

  set(t: number): void {
    this.t = t;
  }
}
