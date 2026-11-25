import { expect, test } from "./fixtures";

const emails = ["first@example.org", "second@example.org", "third@example.org"];

// A single native-text page with known offsets and three independent decisions.
function emailPdf() {
  const stream =
    "BT /F1 16 Tf 40 740 Td 24 TL " +
    emails.map((email) => "(" + email + ") Tj T*").join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(source.length);
    source += i + 1 + " 0 obj\n" + object + "\nendobj\n";
  }
  const start = source.length;
  source +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((x) => String(x).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    start +
    "\n%%EOF\n";
  return {
    name: "choices.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(source),
  };
}

test("approved PDF text enters the provider only on insertion and leaves only on send", async ({
  extension,
  chat,
}) => {
  const editor = chat.locator("#prompt-textarea");
  await editor.fill("Existing draft.");
  const panel = await extension.panel();
  await expect(panel.locator("#pdf-file")).toBeEnabled();
  await expect(panel.locator("#pdf-tools input[type=checkbox]")).toHaveCount(0);
  const requests: string[] = [];
  await chat.route("**/fixture-send", async (route) => {
    requests.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, body: "OK" });
  });
  const observed = await chat.evaluateHandle(() => {
    const values: string[] = [];
    const pageEditor = document.querySelector<HTMLElement>("#prompt-textarea")!;
    const capture = () => values.push(pageEditor.innerText);
    new MutationObserver((records) => {
      capture();
      for (const record of records) {
        if (record.oldValue) values.push(record.oldValue);
        for (const node of record.removedNodes)
          values.push(node.textContent ?? "");
      }
    }).observe(pageEditor, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
    pageEditor.addEventListener("input", capture);
    document.querySelector("form")!.addEventListener("submit", () => {
      void fetch("/fixture-send", {
        method: "POST",
        body: pageEditor.innerText,
      });
    });
    return values;
  });
  await panel.locator('input[type="file"]').setInputFiles(emailPdf());
  await expect(panel.locator("#pdf-insert")).toBeEnabled();
  await expect(panel.locator("#pdf-preview .pdf-inline-value")).toHaveCount(3);
  const marks = panel.locator("#pdf-preview .pdf-inline-value");
  await marks.nth(1).click();
  await panel
    .locator("#pdf-preview")
    .getByRole("button", { name: "Mask", exact: true })
    .click();
  await expect(marks.nth(1)).toHaveClass(/redact/);
  await marks.nth(2).click();
  await panel.locator("#pdf-preview").getByRole("checkbox").click();
  await expect(marks.nth(2)).toHaveClass(/keep/);
  await panel.locator("#pdf-as-sent").click();
  await expect(marks.first()).toHaveText(/^\[\[EMAIL_[A-Z0-9]+\]\]$/);
  const exactToken = await marks.first().innerText();
  await expect(editor).toHaveText("Existing draft.");
  expect(requests).toEqual([]);
  await panel.locator("#pdf-insert").click();
  await expect(editor).toContainText(emails[2]);
  const approved = await editor.innerText();
  expect(approved).toContain(exactToken);
  expect(approved).toMatch(
    /Existing draft\.[\s\S]*\[\[EMAIL_[A-Z0-9]+\]\][\s\S]*\[EMAIL\]/,
  );
  const captured = await observed.jsonValue();
  for (const email of emails.slice(0, 2))
    expect(captured.join("\n")).not.toContain(email);
  expect(
    await chat
      .locator('input[type="file"]')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
  expect(requests).toEqual([]);
  await chat.locator('[data-testid="send-button"]').click();
  await expect.poll(() => requests).toEqual([approved]);
  await extension.restart();
  await extension.newChat();
  const reopened = await extension.panel();
  await reopened.locator('[data-view="data"]').click();
  await expect(reopened.locator("#originals")).toContainText(emails[0]);
  await expect(reopened.locator("#originals")).not.toContainText(emails[1]);
  await expect(reopened.locator("#originals")).not.toContainText(emails[2]);
});

test("changing the chat draft during PDF review preserves the edit", async ({
  extension,
  chat,
}) => {
  const panel = await extension.panel();
  await panel.locator('input[type="file"]').setInputFiles(emailPdf());
  await expect(panel.locator("#pdf-insert")).toBeEnabled();
  const editor = chat.locator("#prompt-textarea");
  await editor.fill("My newer draft");
  await panel.locator("#pdf-insert").click();
  await expect(panel.locator("#pdf-status")).toContainText(
    /changed|scan again/i,
  );
  await expect(editor).toHaveText("My newer draft");
});

test("switching conversations prevents PDF insertion in either draft", async ({
  extension,
  chat,
}) => {
  const panel = await extension.panel();
  await panel.locator('input[type="file"]').setInputFiles(emailPdf());
  await expect(panel.locator("#pdf-insert")).toBeEnabled();
  const other = await extension.newChat({ path: "/c/other" });
  await other.bringToFront();
  // A native side panel can stay open when the active tab changes.
  await panel.locator("#pdf-insert").click();
  await expect(panel.locator("#pdf-status")).toContainText(
    /changed|scan again|original/i,
  );
  await expect(chat.locator("#prompt-textarea")).toBeEmpty();
  await expect(other.locator("#prompt-textarea")).toBeEmpty();
});

test("a rejected PDF vault commit leaves all originals out of the draft", async ({
  extension,
  chat,
}) => {
  const panel = await extension.panel();
  await panel.locator('input[type="file"]').setInputFiles(emailPdf());
  await expect(panel.locator("#pdf-insert")).toBeEnabled();
  // Inject a commit failure at the panel's messaging boundary.
  await panel.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (message: { type: string }) =>
        message.type === "pdf-apply"
          ? Promise.resolve({ error: "vault_write_failed" })
          : original(message),
    });
  });
  await panel.locator("#pdf-insert").click();
  await expect(panel.locator("#pdf-status")).toContainText(
    /fail|save|insert|error/i,
  );
  await expect(chat.locator("#prompt-textarea")).toBeEmpty();
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const detector of ["cnn", "rampart"])
  test(`mixed PDF review and insertion with ${detector} run offline with one copy of each text layer`, async ({
    extension,
    chat,
  }) => {
    const options = await extension.options();
    await expect(options.locator("#detector")).toHaveValue("rampart");
    if (detector === "cnn") {
      await options.locator("#detector").selectOption(detector);
      await expect(options.locator("#status")).toHaveText("Saved");
    }
    await options.close();
    const panel = await extension.panel();
    await extension.context.setOffline(true);
    await panel
      .locator("#pdf-file")
      .setInputFiles("e2e/pdf-fixtures/mixed.pdf");
    await expect(panel.locator("#pdf-insert")).toBeEnabled({ timeout: 30000 });
    const extracted = (await panel.locator("#pdf-preview").textContent()) ?? "";
    for (const value of ["jane@example.com", "123 Main Street", "Unit 4"]) {
      expect(extracted.toLowerCase().split(value.toLowerCase())).toHaveLength(
        2,
      );
    }
    const findings = await panel
      .locator("#pdf-preview .pdf-inline-value")
      .allTextContents();
    await panel.locator("#pdf-insert").click();
    await expect(panel.locator("#pdf-status")).toContainText(
      "Inserted into your draft",
    );
    const approved = await chat.locator("#prompt-textarea").innerText();
    expect(approved).not.toContain("jane@example.com");
    await expect(chat.locator("#sent-count")).toHaveText("0");
    if (process.env.PDF_EVAL)
      console.log(JSON.stringify({ detector, extracted, findings, approved }));
  });

test("dropping a PDF and undoing insertion restores the original chat draft", async ({
  extension,
  chat,
}) => {
  const editor = chat.locator("#prompt-textarea");
  await editor.fill("Draft introduction");
  const panel = await extension.panel();
  const transfer = await panel.evaluateHandle(
    ({ bytes, name }) => {
      const data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(bytes)], name, { type: "application/pdf" }),
      );
      return data;
    },
    { bytes: [...emailPdf().buffer], name: "dropped.pdf" },
  );
  await panel
    .locator("#pdf-drop")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(panel.locator("#pdf-file-name")).toHaveText("dropped.pdf");
  await panel.locator("#pdf-as-sent").click();
  await expect(panel.locator("#pdf-preview")).toContainText("[[EMAIL_");
  await panel.locator("#pdf-insert").click();
  const badge = extension.badge(chat);
  await expect
    .poll(async () => (await badge.state(".paste-toast")).text)
    .toContain("Inserted");
  await badge.click(".toast-undo");
  await expect(editor).toHaveText("Draft introduction");
  await expect(chat.locator("#sent-count")).toHaveText("0");
});
