/** Keep format-owned values out of contextual NER without shifting UTF-16 spans. */
export function rampartModelInput(text: string): string {
  return (
    text
      // Core alone owns UUID detection, including the user's explicit opt-in.
      .replace(
        /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi,
        (uuid) => " ".repeat(uuid.length),
      )
      // SDK 0.1.3 mixes codepoint and UTF-16 indexing after astral characters.
      .replace(/[\u{10000}-\u{10ffff}]/gu, "  ")
  );
}
