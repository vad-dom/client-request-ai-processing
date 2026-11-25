import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const AI_TIMEOUT_MS = 300;
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);

async function getTriageResult(text) {
  const fallback = { status: "manual_review", topic: null, draft: null };

  try {
    const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
    const result = JSON.parse(await classify(text, { signal }));

    if (!ALLOWED_TOPICS.has(result?.topic)) return fallback;
    if (typeof result.draft !== "string") return fallback;
    if (result.draft.trim() === "") return fallback;

    return { status: "ready", topic: result.topic, draft: result.draft };
  } catch {
    return fallback;
  }
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  let body;

  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  const text = body?.text;

  if (typeof text !== "string" || text.trim() === "") {
    return json(response, 400, { status: "invalid_input" });
  }

  const result = await getTriageResult(text);
  return json(response, 200, result);
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");
