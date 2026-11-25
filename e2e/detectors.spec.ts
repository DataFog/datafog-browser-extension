import { test, expect } from "./fixtures";
import { writeFile } from "node:fs/promises";

const cases = [
  {
    language: "en",
    text:
      "My name is Zoe\u0308 Hartwell. " +
      "The report contains routine observations. ".repeat(100) +
      "Please contact Nadia Whitcombe.",
    gold: [
      { value: "Zoe\u0308 Hartwell", type: "PERSON" },
      { value: "Nadia Whitcombe", type: "PERSON" },
    ],
  },
  {
    language: "en",
    text: "Please contact Elara Whitcombe about the appointment.",
    gold: [{ value: "Elara Whitcombe", type: "PERSON" }],
  },
  {
    language: "en",
    text: "I spoke to Nadia yesterday.",
    gold: [{ value: "Nadia", type: "PERSON" }],
  },
  {
    language: "en",
    text: "😀 My name is José Muñoz. Email jose@example.org.",
    gold: [
      { value: "José Muñoz", type: "PERSON" },
      { value: "jose@example.org", type: "EMAIL" },
    ],
  },
  {
    language: "en",
    text: "My mailing address is 319 Cedar Lane\nUnit 7B\nPortland, OR 97205.",
    gold: [
      { value: "319 Cedar Lane\nUnit 7B\nPortland, OR 97205", type: "ADDRESS" },
    ],
  },
  {
    language: "es",
    text: "Me llamo Lucía Valdés y mi correo es lucia@example.org.",
    gold: [
      { value: "Lucía Valdés", type: "PERSON" },
      { value: "lucia@example.org", type: "EMAIL" },
    ],
  },
  {
    language: "fr",
    text: "Je m'appelle Élodie Moreau. Merci de me contacter.",
    gold: [{ value: "Élodie Moreau", type: "PERSON" }],
  },
  {
    language: "de",
    text: "Mein Name ist Jürgen Weiß. Bitte rufen Sie mich an.",
    gold: [{ value: "Jürgen Weiß", type: "PERSON" }],
  },
  {
    language: "en",
    text: "The meeting is tomorrow. Please bring the quarterly report.",
    gold: [],
  },
  {
    language: "en",
    text: "I enjoy cedar trees and walking along the river.",
    gold: [],
  },
];

test("CNN and Rampart packaged offline comparison", async ({
  extension,
}, testInfo) => {
  test.setTimeout(240_000);
  const options = await extension.options();
  await options.context().setOffline(true);
  const records = [];
  for (const detector of ["cnn", "rampart"] as const) {
    const changed = await options.evaluate(async (selectedDetector) => {
      const settings = await chrome.runtime.sendMessage({
        type: "settings-get",
      });
      return chrome.runtime.sendMessage({
        type: "settings-save",
        settings: {
          ...settings,
          detector: selectedDetector,
          entities: ["PERSON", "ADDRESS", "EMAIL", "SSN", "STREET_ADDRESS"],
        },
      });
    }, detector);
    expect(changed.error).toBeUndefined();
    for (const item of cases) {
      const started = Date.now();
      const response = await options.evaluate(
        async (text) =>
          chrome.runtime
            .sendMessage({
              target: "offscreen",
              request: { type: "pdf-scan", text },
            })
            .then((reply) => reply.result ?? reply),
        item.text,
      );
      expect(response.error, JSON.stringify(response)).toBeUndefined();
      const findings: {
        start: number;
        end: number;
        original: string;
        entityType: string;
      }[] = response.findings;
      const gold = item.gold.map((g) => ({
        ...g,
        start: item.text.indexOf(g.value),
        end: item.text.indexOf(g.value) + g.value.length,
      }));
      const leaks = gold.filter((g) =>
        Array.from(g.value).some(
          (c, i) =>
            /[\p{L}\p{N}]/u.test(c) &&
            !findings.some(
              (f) => f.start <= g.start + i && f.end > g.start + i,
            ),
        ),
      );
      const falseReplacements = findings.filter(
        (f) => !gold.some((g) => f.start < g.end && f.end > g.start),
      );
      const exact = gold.filter((g) =>
        findings.some(
          (f) =>
            f.start === g.start && f.end === g.end && f.entityType === g.type,
        ),
      );
      records.push({
        detector,
        ...item,
        milliseconds: Date.now() - started,
        findings,
        leaks: leaks.map((g) => g.value),
        falseReplacements,
        falseReplacementCharacters: findings.reduce(
          (sum, f) =>
            sum +
            Array.from(item.text.slice(f.start, f.end)).filter(
              (c, i) =>
                /[\p{L}\p{N}]/u.test(c) &&
                !gold.some(
                  (g) => g.start <= f.start + i && g.end > f.start + i,
                ),
            ).length,
          0,
        ),
        exact: exact.length,
      });
    }
  }
  const accented = records.find(
    (r) => r.detector === "rampart" && r.text.startsWith("😀"),
  );
  expect(accented?.leaks).toEqual([]);
  expect(accented?.exact).toBe(2);
  const report = {
    browser: options.context().browser()?.version(),
    fixtureOrigin:
      "Locally authored synthetic acceptance examples; training overlap unknown. No held-out generalization claim.",
    records,
  };
  await writeFile(
    testInfo.outputPath("detector-comparison.json"),
    JSON.stringify(report, null, 2),
  );
  await testInfo.attach("detector-comparison", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  expect(
    records
      .filter((r) => r.detector === "rampart")
      .some((r) => r.findings.some((f) => f.entityType === "PERSON")),
  ).toBe(true);
});
