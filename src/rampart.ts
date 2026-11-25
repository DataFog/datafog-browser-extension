/** Rampart's model findings adapted to Core's ranges and transformation policy. */
import type { Finding, ScanConfig } from "@datafog/wasm";
import type { Span } from "@nationaldesignstudio/rampart";
import { scanRules } from "./detect";
import type { ModelSession } from "./model";

export function rampartFindings(
  text: string,
  spans: Span[],
  entities: readonly string[],
): Finding[] {
  const encoder = new TextEncoder();
  const mapped: Finding[] = [];
  for (const span of spans) {
    const entityType = ["GIVEN_NAME", "SURNAME"].includes(span.label)
      ? "PERSON"
      : [
            "BUILDING_NUMBER",
            "STREET_NAME",
            "SECONDARY_ADDRESS",
            "CITY",
            "STATE",
            "ZIP_CODE",
          ].includes(span.label)
        ? "ADDRESS"
        : null;
    if (!entityType || !entities.includes(entityType)) continue;
    const { start } = span;
    let { end } = span;
    // Never send malformed model coordinates into Core's byte-based transforms.
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length ||
      text.slice(start, end) !== span.text
    )
      throw new Error("rampart_invalid_span");
    for (const boundary of [start, end]) {
      const code = text.charCodeAt(boundary);
      if (code >= 0xdc00 && code <= 0xdfff)
        throw new Error("rampart_invalid_span");
    }
    // Include trailing combining marks omitted by the SDK normalization.
    while (end < text.length && /\p{M}/u.test(text[end])) end++;
    mapped.push({
      entityType,
      matchedText: text.slice(start, end),
      utf16Range: { start, end },
      byteRange: {
        start: encoder.encode(text.slice(0, start)).length,
        end: encoder.encode(text.slice(0, end)).length,
      },
      codepointRange: {
        start: Array.from(text.slice(0, start)).length,
        end: Array.from(text.slice(0, end)).length,
      },
      confidence: span.score,
      detectorName: "nationaldesignstudio/rampart",
      detectorVersion: "0.1.3",
    });
  }
  // Group adjacent components into Core's coarse types, including multiline addresses.
  const merged: Finding[] = [];
  for (const finding of mapped.toSorted(
    (a, b) => a.utf16Range.start - b.utf16Range.start,
  )) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.entityType === finding.entityType &&
      previous.utf16Range.end <= finding.utf16Range.start &&
      /^[\s,.'’-]*$/.test(
        text.slice(previous.utf16Range.end, finding.utf16Range.start),
      )
    ) {
      merged[merged.length - 1] = {
        ...previous,
        matchedText: text.slice(
          previous.utf16Range.start,
          finding.utf16Range.end,
        ),
        utf16Range: {
          start: previous.utf16Range.start,
          end: finding.utf16Range.end,
        },
        byteRange: {
          start: previous.byteRange.start,
          end: finding.byteRange.end,
        },
        codepointRange: {
          start: previous.codepointRange.start,
          end: finding.codepointRange.end,
        },
        confidence: Math.min(previous.confidence ?? 0, finding.confidence ?? 0),
      };
    } else merged.push(finding);
  }
  return merged;
}

export class RampartSession implements ModelSession {
  status = "ready";
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (spans: Span[]) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(private readonly worker: Worker) {
    worker.addEventListener("message", ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.error) {
        this.status = "error";
        pending.reject(new Error("rampart_failed"));
      } else pending.resolve(data.spans);
    });
    worker.addEventListener("error", () => this.fail());
    worker.addEventListener("messageerror", () => this.fail());
  }
  static async open(): Promise<RampartSession> {
    const session = new RampartSession(
      new Worker(chrome.runtime.getURL("rampart/worker.js"), {
        type: "module",
      }),
    );
    try {
      await session.request("");
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }
  private request(text: string): Promise<Span[]> {
    const id = this.sequence++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, text }, []);
    });
  }
  async scan(
    text: string,
    config: ScanConfig,
  ): Promise<{ findings: Finding[] }> {
    const entities = config.entities ?? ["PERSON", "ADDRESS"];
    const rules = await scanRules(
      text,
      [...entities],
      config.deny?.map((entry) => entry.phrase),
    );
    return {
      findings: [
        ...rules,
        ...rampartFindings(text, await this.request(text), entities),
      ],
    };
  }
  private fail(): void {
    this.status = "error";
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("rampart_failed"));
    }
    this.pending.clear();
  }
  close(): void {
    this.fail();
    this.status = "closed";
  }
}
