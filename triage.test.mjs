
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const manualReview = { status: "manual_review", topic: null, draft: null };

test("API rejects invalid AI results", async (t) => {
    // Let the OS choose a free port for the test server.
    const previousPort = process.env.PORT;
    process.env.PORT = "0";
    const { server } = await import("./server.mjs");
    t.after(() => new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    }));
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;

    if (!server.listening) await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/api/triage`;

    for (const text of ["[bad-topic]", "[empty-draft]"]) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });

        assert.equal(response.status, 200, text);
        assert.deepEqual(await response.json(), manualReview, text);
    }
});

test("Frontend clears the draft and ignores a stale response", async () => {
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(script, "Expected an inline module script");

    let submit;
    const elements = {
        form: { addEventListener: (event, handler) => { submit = handler; } },
        "#message": { value: "" },
        "#result": { hidden: true },
        "#status": { textContent: "" },
        "#topic": { textContent: "" },
        "#draft": { textContent: "" },
        "#notice": { textContent: "" },
    };

    const response = data => ({ status: 200, json: async () => data });
    const ready = response({ status: "ready", topic: "delivery", draft: "Old draft" });
    let resolveOld;
    const delayedResponse = new Promise(resolve => { resolveOld = resolve; });
    const replies = [ready, delayedResponse, response(manualReview)];

    runInNewContext(script[1], {
        document: { querySelector: selector => elements[selector] },
        fetch: async () => replies.shift(),
    });

    function send(text) {
        elements["#message"].value = text;
        return submit({ preventDefault() { } });
    }

    await send("Previous request");
    assert.equal(elements["#draft"].textContent, "Old draft");

    const oldRequest = send("Slow request");
    assert.equal(elements["#draft"].textContent, "");
    await send("New request");
    assert.equal(elements["#status"].textContent, "Требуется ручная обработка");
    assert.equal(elements["#draft"].textContent, "");

    resolveOld(ready);
    await oldRequest;
    assert.equal(elements["#status"].textContent, "Требуется ручная обработка");
    assert.equal(elements["#topic"].textContent, "Не определена");
    assert.equal(elements["#draft"].textContent, "");
});
