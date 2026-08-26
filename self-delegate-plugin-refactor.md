# Self-Delegate Definition-Owned Plugin Migration

## Goal

Make the Baseera group-chat application an agent plugin declared by the agent
definition. `WhatsAppGroup` should bind group infrastructure and run the
defined agent; it should not select or construct application plugins.

This migration depends on the DeepAgents contract in
[deepagents-plugin-refactor.md](./deepagents-plugin-refactor.md). The local
consumer migration is implemented against linked DeepAgents `6.2.0`; a
reproducible install still depends on publishing that version.

## Current state

- `WhatsAppGroup` creates one `AgentRuntime` for each participant.
- Participant identity, model, instructions, tools, telemetry, and sandbox are
  resolved dynamically.
- `baseeraGroupChatAgent` is the canonical product composition and declares
  `groupChat()` plus `conversationScheduling()` once.
- Each dynamic participant is created with `defineAgent`, the canonical
  composition, and its resolved identity, model, instructions, tools,
  telemetry, and sandbox.
- `WhatsAppGroup` supplies typed group publisher, primary participant,
  scheduler, and timezone bindings to `AgentRuntime`.
- The local group-chat definition owns the public reply tool and the existing
  group and scheduling instructions without capturing runtime infrastructure.
- The current checkout uses locally installed DeepAgents `6.2.0` artifacts
  while package manifests still declare published `6.1.2`.

The source migration is complete. Publication and one environment-blocked
Microsandbox test remain outside the source refactor.

## Target ownership

| Surface                                                      | Owner after migration                      |
| ------------------------------------------------------------ | ------------------------------------------ |
| Plugin selection and order                                   | Defined agent application                  |
| Group participation instructions                             | `groupChat()` definition                   |
| `reply_to_group` schema and behavior                         | `groupChat()` definition                   |
| Agent identity, model, role instructions, and tools          | Participant declaration                    |
| Public transcript and reply validation                       | `WhatsAppGroup`                            |
| Group publisher and primary-participant state                | Group-chat runtime binding                 |
| Turn queue, stream manager, context store, and mailbox store | Runtime host                               |
| Wake queue and scheduler adapter                             | Scheduling runtime binding                 |
| Participant loading and roster changes                       | `ParticipantDirectory` and `WhatsAppGroup` |
| HTTP, SSE, persistence, and activity projection              | Existing application layers                |

## Agent application definition

The canonical Baseera group-chat module owns the reusable plugin list. The
upstream `defineAgent` contract describes concrete agents, while participant
identity and model are resolved dynamically here, so `WhatsAppGroup` spreads
that one composition into its sole `defineAgent` call.

Participant declarations are dynamic, so the application definition must be
composed with each resolved participant without copying the plugin list into
`WhatsAppGroup` or every catalog entry. Use the concrete composition mechanism
published by DeepAgents; do not invent a local template or compatibility
wrapper. The composition is a typed declaration fragment, not another agent
factory.

The resulting defined participant must retain:

- the participant's stable name;
- model and telemetry;
- sandbox factory;
- role-specific instructions;
- participant-specific tools;
- the application plugin definitions.

## `groupChat()` definition

The declaration-time plugin takes no group instance, callback, scheduler, or
participant name.

It owns:

- the group persona and voluntary-participation policy;
- public-reply workflow and style guidance;
- the `reply_to_group` input schema;
- group-specific annotation guidance;
- group-specific rules for silent scheduled work;
- a declared requirement for the group-chat runtime capability.

At tool execution, use runtime-owned `AgentPluginToolContext` for the agent
identity. Resolve the publisher, current group state, and primary participant
from the group-chat binding.

The tool output contract remains:

- posted;
- stopped;
- public reply limit reached;
- transcript changed, including the newer public messages.

## Runtime bindings

`WhatsAppGroup` provides a fresh group-chat binding for each participant
runtime. It adapts the existing private methods without moving their behavior
into DeepAgents.

The binding must preserve:

- immediate publication before slower participants settle;
- author identity from runtime tool context;
- message trimming;
- optional reply targets;
- exact-excerpt annotation validation;
- transcript-change detection and reconsideration;
- public reply and transcript ceilings;
- activity, persistence, and active-participant delivery ordering.

Scheduling infrastructure is supplied separately through the scheduling
plugin binding. The group-chat plugin must not construct or wrap the scheduling
plugin.

## Host migration

- [ ] Install the published DeepAgents version and update the exact dependency
      and lockfile.
- [x] Capture the current API test result before changing composition.
- [x] Add the canonical agent application composition module.
- [x] Convert the local group-chat plugin into a reusable zero-infrastructure
      plugin definition.
- [x] Compose each dynamic participant declaration with the application
      definition through the upstream API.
- [x] Supply the group-chat and scheduling bindings when constructing each
      `AgentRuntime`.
- [x] Remove the plugin list from `WhatsAppGroup` runtime options.
- [x] Delete the lazy publisher-constructor closure once binding resolution no
      longer depends on group construction order.
- [x] Delete local contracts now exported by the upstream plugin API, retaining
      the existing `WhatsAppMessage` and public application types.
- [ ] Remove generic scheduling guidance from `groupChat()` after the upstream
      scheduling plugin owns it. Keep group-publication guidance local.
- [x] Grep the old runtime-plugin construction shape to zero.

## Behavior contract

The migration must preserve every existing group behavior:

- concurrent participant consideration;
- immediate public replies;
- voluntary silence and addressed-participant routing;
- whole-group greetings and single-answer selection;
- short follow-up ownership;
- transcript-change reconsideration;
- mailbox delivery during active turns;
- multiple annotations and response-annotation directives;
- participant-specific tools, models, telemetry, and sandboxes;
- dynamic roster joins;
- scheduling, wakeups, restart recovery, and cancellation;
- durable transcript replay and projection;
- limits, stop behavior, and partial participant failure isolation.

## Required verification

Run checks through Nx:

```sh
nx run api:typecheck
nx run api:test
```

Also verify:

- one exported application definition creates at least two participant
  runtimes concurrently;
- each runtime receives a distinct group-chat and scheduling binding;
- `reply_to_group` publishes with the runtime's participant identity;
- the fast-reply ordering test remains green;
- participant tools remain available beside plugin tools;
- missing bindings fail before a group begins processing messages;
- a clean install uses the declared published DeepAgents version;
- `git diff --check` passes;
- the previous inline prompt/tool construction and
  `AgentRuntimeOptions.plugins` call site are absent.

## Completion criteria

- The canonical application composition declares
  `plugins: [groupChat(), conversationScheduling()]` and is consumed by the
  dynamic `defineAgent` call.
- `WhatsAppGroup` supplies bindings and infrastructure only.
- `groupChat()` is reusable across runtimes and captures no runtime instance.
- The complete API behavior suite retains its expectations; 83 of 84 tests
  pass, with only the local Microsandbox schema/binary mismatch failing before
  application assertions.
- The dependency and lockfile reproduce the verified runtime from a clean
  install.

## Retained application surface

- `WhatsAppGroup` remains the public transcript actor and notification pump.
- `ParticipantDirectory` remains the source of dynamic participant identity
  and capabilities.
- Queue naming, mailbox delivery, persistence, activity projection, limits,
  and validation remain application-owned.
- Group-specific prompt policy remains local because it is product behavior,
  not a DeepAgents default.

## Non-goals

- Moving WhatsApp transport or persistence into DeepAgents.
- Copying the application plugin list into every catalog participant.
- A self-delegate-only plugin registry or dependency-injection layer.
- Dynamic installation or removal of plugins in an active group.
- Changing group conversation behavior while moving composition ownership.
