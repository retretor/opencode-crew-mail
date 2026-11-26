import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../crew-mail.js"

const { DEFAULTS, loadSettings, nameMembers, findMember, Limits, envelope, running, describe } = plugin._test
const s = (id, agent, created, time = { busy: 1 }) => ({ id, agent, title: `task of ${id}`, time: { created, ...time } })

test("running: busy since the last idle", () => {
  assert.equal(running({ time: { busy: 5 } }), true)
  assert.equal(running({ time: { busy: 5, idle: 4 } }), true)
  assert.equal(running({ time: { busy: 5, idle: 6 } }), false)
  assert.equal(running({ time: {} }), false)
  assert.equal(running(undefined), false)
})

test("names: lead, unique agent names, numbered duplicates in order of creation", () => {
  const m = nameMembers(s("L", "auto", 0), [s("c2", "coder", 3), s("r", "researcher", 2), s("c1", "coder", 1)])
  assert.deepEqual(m.map((x) => x.handle), ["lead", "coder-1", "researcher", "coder-2"])
  assert.equal(m.find((x) => x.id === "c2").handle, "coder-2")
  assert.equal(m[0].role, "lead")
})

test("find by short name (any case) or session id", () => {
  const m = nameMembers(s("L", "auto", 0), [s("ses_a", "tester", 1)])
  assert.equal(findMember(m, "TESTER").id, "ses_a")
  assert.equal(findMember(m, "ses_a").handle, "tester")
  assert.equal(findMember(m, "lead").id, "L")
  assert.equal(findMember(m, "nobody"), undefined)
  assert.equal(findMember(m, ""), undefined)
})

test("limits per session and per pair within the window", () => {
  let now = 0
  const l = new Limits({ ...DEFAULTS, maxPerSession: 5, maxPerPair: 2, pairWindowMinutes: 1 }, () => now)
  l.count("a", "b")
  l.count("b", "a") // both directions count for the pair
  assert.match(l.check("a", "b"), /2 messages between you two/)
  assert.equal(l.check("a", "c"), undefined)
  now = 61_000
  assert.equal(l.check("a", "b"), undefined, "the window has moved on")
  l.count("a", "c")
  l.count("a", "d")
  l.count("a", "e")
  assert.equal(l.check("a", "f"), undefined, "4 sent by a: b, c, d, e")
  l.count("a", "f")
  assert.match(l.check("a", "f"), /5 messages, the limit of one session/)
})

test("envelope names the sender and says it is not the user", () => {
  const e = envelope({ handle: "coder", agent: "coder", id: "ses_c" }, { handle: "tester" }, "IFoo is in Foo.cs", "m1")
  assert.match(e, /^<crew-message id="m1" from="coder" from-agent="coder" from-session="ses_c" to="tester">\nIFoo is in Foo.cs\n<\/crew-message>/)
  assert.match(e, /not from the user/)
})

test("describe shows the lead as waiting, not finished", () => {
  const [lead, kid] = nameMembers(s("L", "auto", 0, { busy: 1, idle: 2 }), [s("k", "coder", 1, { busy: 1, idle: 3 })])
  assert.match(describe(lead, "k"), /lead \(auto\), waiting/)
  assert.match(describe(kid, "k"), /coder \(you\): coder, finished, task "task of k"/)
})

test("settings: defaults, known keys only, broken file ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-mail-"))
  const f = path.join(dir, "crew-mail.json")
  assert.deepEqual(loadSettings(f), DEFAULTS)
  fs.writeFileSync(f, JSON.stringify({ maxChars: 10, wakeLead: true, unknown: 1 }))
  const got = loadSettings(f)
  assert.equal(got.maxChars, 10)
  assert.equal(got.wakeLead, true)
  assert.equal(got.unknown, undefined)
  fs.writeFileSync(f, "{ not json")
  assert.deepEqual(loadSettings(f), DEFAULTS)
  fs.rmSync(dir, { recursive: true, force: true })
})
