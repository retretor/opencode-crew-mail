// End-to-end: the plugin inside a real `opencode serve`, with a scripted fake model instead of a provider.
// Needs opencode >= 2.2 on PATH. Runs only with CREW_MAIL_E2E=1. Uses temporary folders and two local ports;
// your own opencode configuration and sessions are not touched.
//
// The lead starts a coder and a researcher in the background. The coder writes to the running researcher;
// the researcher reads it at its next step, tries to answer the coder after it finished (refused) and writes to the
// lead, which reads it when the next report wakes it.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.join(HERE, "..", "crew-mail.js")
const PASSWORD = "crew-mail-test"
const skip = process.env.CREW_MAIL_E2E === "1" ? false : "set CREW_MAIL_E2E=1 to run (needs opencode on PATH)"

const freePort = () =>
  new Promise((ok) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- fake model: OpenAI-compatible streaming. The lead follows LEAD; a subagent follows the steps in its prompt.
const tool = (name, args) => ({ tool: [name, args] })
const sub = (agent, steps) => tool("subagent", { agent, description: agent, prompt: `go ${agent} ${JSON.stringify({ steps })}`, background: true })
const LEAD = [
  sub("coder", [{ wait: 2, ...tool("crew_list", {}) }, tool("crew_send", { to: "researcher", text: "IFoo is in src/Foo.cs" }), { text: "coder report" }]),
  sub("researcher", [{ wait: 5, ...tool("crew_list", {}) }, tool("crew_send", { to: "coder", text: "thanks" }), tool("crew_send", { to: "lead", text: "note for the lead" }), { text: "researcher report" }]),
  { text: "waiting for the reports" },
]

function fakeModel(requests) {
  let lead = 0
  return http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", async () => {
      if (req.method !== "POST") return res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}')
      const b = JSON.parse(body)
      requests.push(b)
      const system = JSON.stringify(b.messages[0])
      const users = b.messages.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content)).join(" ")
      let r
      if (!b.tools) r = { text: "Title" }
      else if (system.includes("TEST-LEAD")) r = LEAD[lead++] ?? { text: "done" }
      else {
        const m = /go \w+ (\{.*\})/.exec(JSON.parse(JSON.stringify(users)).replace(/\\"/g, '"'))
        const steps = m ? JSON.parse(m[1]).steps : [{ text: "?" }]
        const n = b.messages.filter((x) => x.role === "assistant").length
        r = steps[Math.min(n, steps.length - 1)]
      }
      await sleep((r.wait || 0) * 1000)
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" })
      const base = { id: "x", object: "chat.completion.chunk", model: "fake" }
      const ev = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`)
      if (r.tool) ev({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: r.tool[0], arguments: JSON.stringify(r.tool[1]) } }] }, finish_reason: null }] })
      else ev({ choices: [{ index: 0, delta: { role: "assistant", content: r.text }, finish_reason: null }] })
      ev({ choices: [{ index: 0, delta: {}, finish_reason: r.tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
      res.end("data: [DONE]\n\n")
    })
  })
}

function setup(root, modelPort) {
  const cfg = path.join(root, "config", "opencode")
  fs.mkdirSync(path.join(cfg, "plugins"), { recursive: true })
  fs.mkdirSync(path.join(cfg, "agents"), { recursive: true })
  fs.mkdirSync(path.join(root, "project"), { recursive: true })
  fs.copyFileSync(PLUGIN, path.join(cfg, "plugins", "crew-mail.js"))
  const model = { name: "fake", type: "chat", capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 4000 } }
  fs.writeFileSync(
    path.join(cfg, "opencode.json"),
    JSON.stringify({
      model: "fake/fake",
      default_agent: "lead",
      share: "disabled",
      update: "disable",
      providers: { fake: { package: "@opencode/ai/providers/openai-compatible", name: "fake", settings: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: "none" }, models: { fake: model } } },
    }),
  )
  const agent = (name, mode, text) =>
    fs.writeFileSync(path.join(cfg, "agents", `${name}.md`), `---\ndescription: ${name} of the test\nmode: ${mode}\npermissions:\n  - { action: question, resource: "*", effect: deny }\n---\n${text}\n`)
  agent("lead", "primary", "TEST-LEAD")
  for (const a of ["coder", "researcher"]) agent(a, "subagent", `You are the test ${a}.`)
  return cfg
}

test("subagents write to each other directly", { skip, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crew-mail-e2e-"))
  const requests = []
  const model = fakeModel(requests)
  const modelPort = await freePort()
  await new Promise((ok) => model.listen(modelPort, "127.0.0.1", ok))
  setup(root, modelPort)
  const port = await freePort()
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_SERVER_PASSWORD: PASSWORD, OPENCODE_DISABLE_MODELS_FETCH: "1" }
  delete env.OPENCODE_CONFIG_DIR
  // on Windows opencode is a .cmd shim, which only a shell can start; the command has no outside input
  const cmd = `opencode serve --port ${port} --hostname 127.0.0.1`
  const server = process.platform === "win32" ? spawn(cmd, { env, cwd: path.join(root, "project"), shell: true, stdio: "ignore" }) : spawn("opencode", cmd.split(" ").slice(1), { env, cwd: path.join(root, "project"), stdio: "ignore" })
  const url = `http://127.0.0.1:${port}`
  const auth = { authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64"), "content-type": "application/json" }
  const api = async (method, p, body) => {
    const r = await fetch(url + p, { method, headers: auth, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text()
    assert.ok(r.ok, `${method} ${p}: ${r.status} ${t.slice(0, 300)}`)
    return t ? JSON.parse(t) : {}
  }
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(url + "/")
        break
      } catch {
        if (i > 120) throw new Error("opencode serve did not start")
        await sleep(500)
      }
    }
    const created = await api("POST", "/api/session", { agent: "lead", model: { providerID: "fake", id: "fake" }, location: { directory: path.join(root, "project") } })
    const lead = (created.data ?? created).id
    await api("POST", `/api/session/${lead}/prompt`, { text: "start" })
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const active = await api("GET", "/api/session/active")
      if (i > 8 && !Object.keys(active.data ?? {}).length) break
    }

    const text = (b) => JSON.stringify(b.messages)
    const of = (agent) => requests.filter((b) => b.tools && text(b).includes(`go ${agent} `))
    const coder = of("coder")
    const researcher = of("researcher")
    const leadSeen = requests.filter((b) => b.tools && JSON.stringify(b.messages[0]).includes("TEST-LEAD"))
    assert.ok(coder.some((b) => /Your team \(you are coder\)/.test(text(b)) && /researcher: researcher, running/.test(text(b))), "crew_list shows the running researcher")
    assert.ok(coder.some((b) => /researcher: delivered/.test(text(b))), "the coder's message was delivered")
    assert.ok(researcher.some((b) => /<crew-message id=\\"m1\\" from=\\"coder\\"[^>]*>\\nIFoo is in src\/Foo.cs/.test(text(b))), "the running researcher read it at its next step")
    assert.ok(researcher.some((b) => /coder: not sent, it has finished/.test(text(b))), "no message to a finished subagent")
    assert.ok(leadSeen.some((b) => /from=\\"researcher\\"[^>]*to=\\"lead\\">\\nnote for the lead/.test(text(b))), "the lead read the researcher's message")
    const log = fs.readFileSync(path.join(root, "data", "opencode", "log", "crew-mail.log"), "utf8")
    assert.match(log, /"from":"coder".*"to":"researcher"/)
  } finally {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
      } catch {}
    } else server.kill()
    model.close()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
})
