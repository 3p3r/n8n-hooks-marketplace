# n8n-hooks-marketplace

Decentralized Workflow Marketplace for N8N Self Hosted Instances over MQTT

## Synopsis

This repository offers a decentralized marketplace that connects multiple self hosted N8N instances together and allows them to communicate with each other over a local network and through an MQTT server.

This marketplace enables Workflow discoverability and sharing within a closed network.

## Architecture

The marketplace itself is integrated into N8N through frontend and backend [Hooks](https://docs.n8n.io/deploy/host-n8n/configure-n8n/external-hooks#frontend-external-hooks). After launching your N8N instance with these Hooks, a tab shows up in the main N8N editor next to Editor, Executions and Evaluations tabs called "Ecosystem".

The Ecosystem tab uses a configurable [MQTT broker](https://www.rabbitmq.com/docs/mqtt) URL to talk to other N8N instances that have the same Hook enabled in them. The URL is configurable through environment variables before launching N8N.

The backend hooks are a set of REST helpers to enable Workflow discoverability. Individual Workflows inside the self hosted instances are hidden to the Ecosystem tab by default, unless they include a [Sticky Note node](https://docs.n8n.io/build/understand-workflows/workflow-components/add-notes-and-documentation) in them which is written in Markdown with the format of a [SKILL.md](https://agentskills.io/specification) file.

The metadata field in the Sticky Note node can optionally include the following:

- author
- version
- tags

The Ecosystem UI allows discovering, filtering, fuzzy searching, downloading and registering other N8N instances' Workflows into the current instance. Majority of these operations happen in UI and with [MQTT.js](https://github.com/mqttjs/MQTT.js). The backend only aids in discovering Workflows that are hidden to the current N8N user and providing a route to return the configured MQTT brokers address for the UI.
