/**
 * Names and mailing addresses, found by Core's bundled model in its own
 * Worker. Runs in the offscreen document; every other type uses Core's rules.
 */

import type { Finding } from "@datafog/wasm";

import { scanRules, type Scanner } from "./detect";
import { MODEL_ENTITIES } from "./settings";

/** What the scanner needs from Core's CnnSession. */
export interface ModelSession {
  readonly status: string;
  scan(
    text: string,
    config: { entities: string[] },
  ): Promise<{ findings: Finding[] }>;
  close(): void;
}

/**
 * Whether any of these types needs the model.
 *
 * @param entities The selected types.
 * @returns True if the model must run.
 */
export function needsModel(entities: string[]): boolean {
  return entities.some((type) => MODEL_ENTITIES.includes(type));
}

/** Finds values with the model when names or addresses are selected. */
export class ModelScanner {
  private session: Promise<ModelSession> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param open Starts a session with the model loaded.
   */
  constructor(private readonly open: () => Promise<ModelSession>) {}

  /**
   * Find values, one scan at a time: a session takes one request at once.
   *
   * @param text The prompt.
   * @param entities The types to find.
   * @returns What Core found.
   */
  readonly scan: Scanner = (text, entities) => {
    const next = this.queue.then(() => this.run(text, entities));
    this.queue = next.catch(() => {});
    return next;
  };

  /**
   * Find values with the model, or with the rules when it isn't needed.
   *
   * @param text The prompt.
   * @param entities The types to find.
   * @returns What Core found.
   */
  private async run(text: string, entities: string[]): Promise<Finding[]> {
    if (!needsModel(entities)) {
      // Free the model's Worker while names and addresses are off
      await this.close();
      return scanRules(text, entities);
    }
    const session = await this.ready();
    const result = await session.scan(text, { entities });
    return result.findings;
  }

  /**
   * The open session, starting one if there's none or the last one failed.
   *
   * @returns The session.
   */
  private async ready(): Promise<ModelSession> {
    const current = await this.session?.catch(() => null);
    if (current && current.status !== "error" && current.status !== "closed") {
      return current;
    }
    current?.close();
    this.session = this.open();
    return this.session;
  }

  /** Close the session, if there is one. */
  private async close(): Promise<void> {
    const current = await this.session?.catch(() => null);
    current?.close();
    this.session = null;
  }
}
