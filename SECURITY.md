# Security policy

## Supported versions

Fixes go into the latest release only.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/retretor/opencode-crew-mail/security/advisories/new), with the steps or messages that show the problem and the versions of opencode and of the plugin. You get an answer within a week; a fix and an advisory follow once the problem is confirmed.

## Scope

In scope: a way to send a message outside the session tree, to get around the limits, to make a message look like it comes from the user, or to make the plugin write anywhere but its log file.

Out of scope: what a model does with a message it receives. A message is model output, and an agent that read something malicious can pass it on; see "Safety" in the [README](README.md#safety).
