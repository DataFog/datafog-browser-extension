import { expect, test } from "vitest";
import type { Span } from "@nationaldesignstudio/rampart";
import { rampartFindings } from "./rampart";
const span = (text: string, value: string, label: Span["label"]): Span => ({
  start: text.indexOf(value),
  end: text.indexOf(value) + value.length,
  text: value,
  label,
  score: 0.9,
  source: "ner",
});
test("accented components retain UTF-8, UTF-16 and codepoint coordinates after an emoji", () => {
  const text = "😀 Meet José Muñoz.";
  const [found] = rampartFindings(
    text,
    [span(text, "José", "GIVEN_NAME"), span(text, "Muñoz", "SURNAME")],
    ["PERSON"],
  );
  expect(found.matchedText).toBe("José Muñoz");
  expect(found.utf16Range).toEqual({ start: 8, end: 18 });
  expect(found.byteRange).toEqual({ start: 10, end: 22 });
  expect(found.codepointRange).toEqual({ start: 7, end: 17 });
});
test("address policy includes city state and ZIP and groups multiline components", () => {
  const text = "19 Cedar Road\nUnit 4\nBoston, MA 02110";
  const spans = [
    span(text, "19", "BUILDING_NUMBER"),
    span(text, "Cedar Road", "STREET_NAME"),
    span(text, "Unit 4", "SECONDARY_ADDRESS"),
    span(text, "Boston", "CITY"),
    span(text, "MA", "STATE"),
    span(text, "02110", "ZIP_CODE"),
  ];
  expect(rampartFindings(text, spans, ["ADDRESS"])[0].matchedText).toBe(text);
  expect(rampartFindings(text, spans, ["PERSON"])).toEqual([]);
});
test("rejects inconsistent and surrogate-splitting coordinates", () => {
  const text = "😀 Ana";
  expect(() =>
    rampartFindings(
      text,
      [{ ...span(text, "Ana", "GIVEN_NAME"), start: 1 }],
      ["PERSON"],
    ),
  ).toThrow("rampart_invalid_span");
});

test("combining marks remain part of the name span", () => {
  const text = "Zoe\u0308 Hartwell";
  const result = rampartFindings(
    text,
    [span(text, "Zoe", "GIVEN_NAME"), span(text, "Hartwell", "SURNAME")],
    ["PERSON"],
  );
  expect(result).toHaveLength(1);
  expect(result[0].matchedText).toBe(text);
});
