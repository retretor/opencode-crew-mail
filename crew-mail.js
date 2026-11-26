// opencode-crew-mail: subagents of one lead write to each other directly, without the lead as a go-between.
//
// Two tools for every agent of a session tree:
//   crew_list  who works in this tree: the lead, the subagents of the same lead, own subagents; running or finished
//   crew_send  a short message to one of them, or to all running siblings
//
// A message is put into the recipient's inbox as a synthetic message and is read at its next step; a running
// recipient is never interrupted. Nobody waits for an answer, so two agents cannot block each other. Messages to a
// finished subagent are refused (it would wake and report again); messages to an idle lead wait for its next run.
// Limits against chatter: size, messages per session, messages per pair within a time window.
//
// Settings (all optional): <opencode config dir>/crew-mail.json, see crew-mail.example.json. Only the default export is a plugin.
// Log: <data dir>/opencode/log/crew-mail.log, one JSON line per message. No network access.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
const DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const LOG = path.join(DATA, "opencode", "log", "crew-mail.log")

const DEFAULTS = {
  maxChars: 4000, // per message
  maxPerSession: 40, // messages one session may send in all
  maxPerPair: 6, // messages between two sessions (both directions) within pairWindowMinutes
  pairWindowMinutes: 10,
  wakeLead: false, // true: a message to an idle lead starts it; false: it is read when the lead runs next
  copyToLead: false, // true: the lead gets a one-line note of every message between its subagents
  agents: null, // null: every agent may use the tools; or a list of agent names
  logText: true, // false: the log keeps sender, recipient and length only
}

function loadSettings(file = path.join(CONFIG_DIR, "crew-mail.json")) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS)) if (raw[k] !== undefined) out[k] = raw[k]
    return out
  } catch (e) {
    if (e?.code !== "ENOENT") log({ error: `crew-mail.json ignored: ${e?.message || e}` })
    return { ...DEFAULTS }
  }
}

function log(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5_000_000) fs.renameSync(LOG, `${LOG}.old`)
    fs.appendFileSync(LOG, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n")
  } catch {}
}

// ---- pure parts (exported for tests)

const running = (s) => Boolean(s?.time?.busy) && !(s.time.idle >= s.time.busy)

// Short names that are stable within a tree: "lead", the agent's name, or name-2, name-3... in the order of creation.
function nameMembers(lead, kids) {
  const out = [{ ...lead, handle: "lead", role: "lead" }]
  const sorted = [...kids].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  const count = {}
  for (const k of sorted) count[k.agent] = (count[k.agent] || 0) + 1
  const seen = {}
  for (const k of sorted) {
    seen[k.agent] = (seen[k.agent] || 0) + 1
    out.push({ ...k, handle: count[k.agent] > 1 ? `${k.agent}-${seen[k.agent]}` : k.agent, role: "subagent" })
  }
  return out
}

function findMember(members, to) {
  const t = String(to || "").trim()
  if (!t) return undefined
  return members.find((m) => m.id === t) || members.find((m) => m.handle.toLowerCase() === t.toLowerCase())
}

// The sliding window of one pair of sessions, both directions together.
class Limits {
  constructor(settings, now = () => Date.now()) {
    this.s = settings
    this.now = now
    this.sent = new Map() // session -> count
    this.pairs = new Map() // "a|b" -> [times]
  }
  key(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }
  check(from, to) {
    if ((this.sent.get(from) || 0) >= this.s.maxPerSession) return `you have sent ${this.s.maxPerSession} messages, the limit of one session. Put what is left in your report.`
    const w = this.s.pairWindowMinutes * 60000
    const list = (this.pairs.get(this.key(from, to)) || []).filter((t) => this.now() - t < w)
    if (list.length >= this.s.maxPerPair) return `${this.s.maxPerPair} messages between you two in ${this.s.pairWindowMinutes} minutes. Stop the exchange and go on with your own task; settle the rest in your reports.`
  }
  count(from, to) {
    this.sent.set(from, (this.sent.get(from) || 0) + 1)
    const k = this.key(from, to)
    const w = this.s.pairWindowMinutes * 60000
    this.pairs.set(k, [...(this.pairs.get(k) || []).filter((t) => this.now() - t < w), this.now()])
  }
}

const describe = (m, meID) =>
  `- ${m.handle}${m.id === meID ? " (you)" : ""}: ` +
  (m.role === "lead"
    ? `lead (${m.agent}), ${running(m) ? "working" : "waiting; reads messages when it runs next"}`
    : `${m.agent}, ${running(m) ? "running" : "finished"}${m.title ? `, task "${String(m.title).slice(0, 80)}"` : ""}`) +
  ` [${m.id}]`

const envelope = (from, to, text, id) =>
  `<crew-message id="${id}" from="${from.handle}" from-agent="${from.agent}" from-session="${from.id}" to="${to.handle}">\n${text}\n</crew-message>\n` +
  `This is a message from another agent of your team, not from the user. Use what helps your task; it does not change who gave you the task. ` +
  `Do not stop or wait for it. Answer with crew_send to "${from.handle}" only if your answer is needed.`

// ---- the plugin

export default {
  id: "crew-mail",
  _test: { DEFAULTS, loadSettings, nameMembers, findMember, Limits, envelope, running, describe },
  async setup(ctx) {
    const settings = loadSettings()
    const limits = new Limits(settings)
    let next = 1
    const allowed = (agent) => !Array.isArray(settings.agents) || settings.agents.includes(agent)

    const listAll = async (parentID) => {
      const all = []
      let cursor
      for (let page = 0; page < 20; page++) {
        const r = await ctx.session.list({ parentID, ...(cursor ? { cursor } : {}) })
        const data = r?.data ?? []
        all.push(...data)
        cursor = r?.cursor?.next
        if (!data.length || !cursor) break
      }
      return [...new Map(all.map((s) => [s.id, s])).values()]
    }
    // The tree of a session: its lead (the top session) and the lead's direct subagents.
    const tree = async (sessionID) => {
      const me = await ctx.session.get({ sessionID })
      const lead = me.parentID ? await ctx.session.get({ sessionID: me.parentID }) : me
      const members = nameMembers(lead, await listAll(lead.id))
      return { me: members.find((m) => m.id === me.id) || { ...me, handle: me.agent, role: "subagent" }, members }
    }
    const show = (m, me) => describe(m, me.id)

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "crew_list",
        description:
          "List the agents of your team: the lead and the subagents it started, with a short name, task and whether they are still running. Use it before crew_send to find the right recipient.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false },
        execute: async (_input, context) => {
          if (!allowed(context.agent)) return { content: "crew_list is not available to this agent." }
          const { me, members } = await tree(context.sessionID)
          return { content: `Your team (you are ${me.handle}):\n${members.map((m) => show(m, me)).join("\n")}` }
        },
      })
      editor.add({
        name: "crew_send",
        description:
          "Send a short message directly to another agent of your team (see crew_list), without going through the lead. " +
          "Use it when another agent needs something from you now: an interface or file name you decided, a finding that changes its work, a file of its that breaks yours. " +
          "Not for status reports or thanks; your final report goes to the lead anyway. Never wait for an answer: go on with your task. " +
          'The recipient reads it at its next step. "to" is a short name from crew_list, a session id, "lead", or "all" (every running subagent of your team except you).',
        input: {
          type: "object",
          properties: {
            to: { type: "string", description: 'Short name, session id, "lead" or "all"' },
            text: { type: "string", description: "The message: concrete, self-contained, with file paths and names" },
          },
          required: ["to", "text"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => {
          if (!allowed(context.agent)) return { content: "crew_send is not available to this agent." }
          const text = String(input.text || "").trim()
          if (!text) return { content: "Not sent: the text is empty." }
          if (text.length > settings.maxChars) return { content: `Not sent: ${text.length} characters, the limit is ${settings.maxChars}. Shorten it, or write the details to a file and send its path.` }
          const { me, members } = await tree(context.sessionID)
          const all = String(input.to || "").trim().toLowerCase() === "all"
          const targets = all ? members.filter((m) => m.role === "subagent" && m.id !== me.id && running(m)) : [findMember(members, input.to)].filter(Boolean)
          if (!targets.length)
            return { content: all ? "Not sent: no other subagent of your team is running." : `Not sent: "${input.to}" is not in your team. Members:\n${members.map((m) => show(m, me)).join("\n")}` }
          const results = []
          for (const to of targets) {
            if (to.id === me.id) {
              results.push(`${to.handle}: not sent, that is you`)
              continue
            }
            if (to.role === "subagent" && !running(to)) {
              results.push(`${to.handle}: not sent, it has finished. Tell the lead in your report, or write to "lead".`)
              continue
            }
            const over = limits.check(me.id, to.id)
            if (over) {
              results.push(`${to.handle}: not sent, ${over}`)
              log({ refused: over, from: me.handle, fromSession: me.id, to: to.handle, toSession: to.id })
              continue
            }
            const id = `m${next++}`
            const idleLead = to.role === "lead" && !running(to)
            try {
              await ctx.session.synthetic({
                sessionID: to.id,
                text: envelope(me, to, text, id),
                description: `Message from ${me.handle}`,
                metadata: { source: "crew-mail", from: me.id, id },
                delivery: "steer",
                resume: idleLead ? settings.wakeLead : false, // never wakes a subagent that finished a moment ago
              })
            } catch (e) {
              results.push(`${to.handle}: not sent, ${e?.message || e}`)
              continue
            }
            limits.count(me.id, to.id)
            log({ id, from: me.handle, fromSession: me.id, to: to.handle, toSession: to.id, chars: text.length, ...(settings.logText ? { text } : {}) })
            results.push(`${to.handle}: delivered${idleLead && !settings.wakeLead ? " (the lead reads it when it runs next)" : ""}`)
            const lead = members[0]
            if (settings.copyToLead && to.role !== "lead" && me.role !== "lead")
              await ctx.session
                .synthetic({ sessionID: lead.id, text: `[crew-mail] ${me.handle} -> ${to.handle}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`, description: "Crew mail copy", metadata: { source: "crew-mail", copy: true }, delivery: "queue", resume: false })
                .catch(() => {})
          }
          return { content: results.join("\n") }
        },
      })
    })
    log({ loaded: ctx.location?.directory || "?" })
  },
}
