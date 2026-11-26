# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-11-26

- `crew_list` and `crew_send`: direct messages between the lead and the subagents of one session tree.
- Limits per message, per session and per pair of agents; no messages to finished subagents; optional wake and copy for the lead.
- Unit tests and an end-to-end test against a real `opencode serve` with a fake model.
