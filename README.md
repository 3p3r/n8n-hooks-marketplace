# n8n-hooks-marketplace

Decentralized Workflow Marketplace for N8N Self Hosted Instances over MQTT

## Synopsis

This repository offers a decentralized marketplace that connects multiple self hosted N8N instances together and allows them to communicate with each other over a local network and through an MQTT server.

This marketplace enables Workflow discoverability and sharing within a closed network.

## Architecture

The marketplace itself is integrated into N8N through frontend and backend [Hooks](https://docs.n8n.io/deploy/host-n8n/configure-n8n/external-hooks#frontend-external-hooks). After launching your N8N instance with these Hooks, a tab shows up in the main N8N editor next to Editor, Executions and Evaluations tabs called "Ecosystem".

The Ecosystem tab uses a configurable [MQTT broker](https://www.rabbitmq.com/docs/mqtt) URL to talk to other N8N instances that have the same Hook enabled in them. The URL is configurable through environment variables before launching N8N.

The backend hooks are a set of REST helpers to enable Workflow discoverability. Individual Workflows inside the self hosted instances are hidden to the Ecosystem tab by default, unless they include a [Sticky Note node](https://docs.n8n.io/build/understand-workflows/workflow-components/add-notes-and-documentation) in them which is written in Markdown with the format of a [SKILL.md](https://agentskills.io/specification) file.

The SKILL.md frontmatter may optionally include a `metadata` block with:

- `author`
- `version`
- `tags`

The Ecosystem UI allows discovering, filtering, fuzzy searching, downloading and registering other N8N instances' Workflows into the current instance. Majority of these operations happen in UI and with [MQTT.js](https://github.com/mqttjs/MQTT.js). The backend only aids in discovering Workflows that are hidden to the current N8N user and providing a route to return the configured MQTT brokers address for the UI.

## Setup

Build the hooks bundle, then point n8n at it before starting:

```bash
npm install
npm run build
```

```bash
export EXTERNAL_HOOK_FILES=/absolute/path/to/dist/backend/hooks.cjs
export EXTERNAL_FRONTEND_HOOKS_URLS=http://localhost:5678/rest/ecosystem/bridge.js
export MQTT_BROKER_URL=ws://127.0.0.1:1883
export N8N_SECURE_COOKIE=false
n8n start
```

`MQTT_BROKER_URL` must be reachable from the browser. Use a WebSocket URL (`ws://` or `wss://`), not `mqtt://`.

Every n8n instance that should participate must use the **same MQTT broker** and have these hooks enabled.

## Sharing a workflow

Add a Sticky Note to the workflow with YAML frontmatter in SKILL.md format:

```markdown
---
name: my-skill
description: What this workflow does.
metadata:
  author: your-name
  version: "1.0"
  tags:
    - ecosystem
    - demo
---

Optional body text shown in the note.
```

Required frontmatter fields: `name`, `description`. The `name` must be lowercase alphanumeric with hyphens (max 64 characters).

When the Ecosystem tab is open, shareable workflows from this instance are advertised to peers on the MQTT broker. Other instances see them in their Ecosystem list; users can download and register them into their own n8n.

## Screenshots

The e2e harness boots **three** n8n instances on one MQTT broker. Each instance publishes its own shareable workflows (SKILL sticky notes) and lists workflows from the other two. A private workflow without SKILL frontmatter is never shown.

| Instance | Shares locally | Sees from peers |
| --- | --- | --- |
| A | `invoice-parser`, `slack-notifier` (alice) | bob's and carol's four skills |
| B | `csv-importer`, `webhook-relay` (bob) | alice's and carol's four skills |
| C | `pdf-merger`, `health-ping` (carol) | alice's and bob's four skills |

**Instance A** — peer list includes bob's and carol's workflows (not its own):

![Instance A Ecosystem tab](test/e2e/screenshots/ecosystem-a.png)

**Instance B** — peer list includes alice's and carol's workflows:

![Instance B Ecosystem tab](test/e2e/screenshots/ecosystem-b.png)

**Instance C** — peer list includes alice's and bob's workflows:

![Instance C Ecosystem tab](test/e2e/screenshots/ecosystem-c.png)

Regenerate with `npm run test:e2e`.

## Development

See [AGENTS.md](AGENTS.md) for local development, tests, and MQTT protocol details.
