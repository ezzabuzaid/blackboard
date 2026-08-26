# DeepAgents Definition-Owned Plugin Refactor

## Goal

Make an exported agent definition own its application plugins. `AgentRuntime`
must materialize those plugins with host-provided infrastructure instead of
choosing plugins itself.

The intended shape is an agent module whose `defineAgent(...)` declaration
includes `plugins: [groupChat()]`. The full declaration may still contain the
agent name, model, sandbox, instructions, tools, and subagents.

The corresponding self-delegate migration is tracked in
[self-delegate-plugin-refactor.md](./self-delegate-plugin-refactor.md).

## Current source truth

- Local DeepAgents commit `243def7` implements definition-owned plugins in
  version `6.2.0`.
- `defineAgent` retains reusable `AgentPluginDefinition` values, and each
  `AgentRuntime` materializes fresh instances from host-provided typed
  `AgentPluginBinding` values.
- `AgentRuntimeOptions.plugins` is removed.
- Conversation scheduling exposes reusable definitions and the scheduler and
  timezone capabilities consumed by self-delegate.
- Plugin tools retain `AgentPluginToolContext`, including the runtime agent
  identity used by `reply_to_group`.
- The generic scheduling instruction layer described below has not moved into
  the built-in scheduling plugin, so self-delegate retains that behavior
  locally.
- The API is not published: npm still reports `6.1.2` as the current version.

## Locked decisions

- The agent definition is the single source of truth for plugin composition.
- `AgentRuntimeOptions.plugins` is removed when the migration lands; there is
  no dual plugin source or compatibility merge.
- Values stored in an exported agent definition are reusable plugin
  definitions, not initialized plugin instances.
- Every `AgentRuntime` materializes fresh plugin instances.
- Runtime infrastructure is supplied through typed bindings. Plugin
  definitions do not capture stores, queues, schedulers, transports, or
  application callbacks at module evaluation time.
- Plugins declared on the root agent apply to the complete runtime tree in the
  first version. Subagent-local runtime plugins are out of scope.
- Existing collision checks, lifecycle ordering, worker disposal, and
  conversation reconciliation remain runtime responsibilities.
- Missing bindings and duplicate capabilities fail during runtime
  construction, before work starts.
- This is a breaking experimental API change. Prefer one clear contract over a
  transitional compatibility layer.

## Definition and instance boundary

DeepAgents needs two distinct concepts even if the final public names differ:

1. A reusable plugin definition stored by `defineAgent`.
2. A stateful runtime plugin instance created for one `AgentRuntime`.

A plugin definition may declare:

- a stable plugin name;
- static agent configuration contributions;
- tools and their schemas;
- required runtime capabilities;
- a factory that creates lifecycle behavior from resolved bindings.

A runtime plugin instance may own:

- its initialized `AgentPluginHost`;
- workers and disposables;
- scheduler or queue adapters;
- per-runtime mutable state;
- conversation-availability reconciliation.

The same exported agent definition must be safe to use concurrently in many
runtimes.

## Runtime bindings

Add a typed capability-binding seam to `AgentRuntime`. It must support
application capabilities such as:

- publishing a group-chat reply;
- reading group state required by a tool;
- creating or supplying a conversation scheduler;
- resolving environment values such as timezone.

Bindings are runtime inputs, not plugin selection. The agent definition says
which capabilities it requires; the host says how those capabilities are
implemented for this runtime.

Binding resolution must provide these guarantees:

- every declared requirement is resolved exactly once;
- unknown or unused bindings are rejected;
- two bindings cannot claim the same capability;
- errors identify the plugin and missing or conflicting capability;
- resolved bindings are scoped to one runtime;
- tool calls continue to receive `AgentPluginToolContext` from the runtime.

Do not add a global service locator or process-wide plugin registry.

## `defineAgent` semantics

Extend the declaration returned by `defineAgent` with immutable plugin
definitions. Preserve the existing concrete-agent meaning: name, model,
sandbox, and instructions remain required.

If a plugin-only export with host-provided agent identity is required later,
introduce a separately named template concept. Do not make one `defineAgent`
overload ambiguously return either a concrete agent or a partially bound
template.

The declaration registry must preserve the root plugin list without treating
it as persisted conversation identity. Plugin names and ordering are runtime
composition metadata; agent names remain the stable persisted identity.

## Composition rules

Apply plugin definitions in declaration order.

Runtime construction must:

1. Validate unique plugin names.
2. Resolve all required bindings.
3. Materialize one instance of each plugin.
4. Validate plugin tool collisions against agent and runtime tools.
5. Apply static configuration in declaration order.
6. Build the declaration registry from the configured root.
7. Initialize plugin instances in declaration order.

Runtime disposal remains the reverse of acquired worker order through the
existing disposable stack.

Plugin runtime-context namespaces must not silently overwrite each other.
Either reserve one top-level namespace per plugin name or fail on duplicate
keys.

## Built-in plugin migration

- Convert `fileAgents(...)` into a reusable definition whose filesystem scan
  occurs at runtime materialization or configuration for each runtime.
- Convert `conversationScheduling(...)` into a reusable definition. Move the
  concrete wake scheduler and environment timezone behind declared bindings.
- Convert `schedules(...)` into a reusable definition. Its task store, worker
  infrastructure, and execution adapters are runtime bindings.
- Keep public control surfaces such as schedule management available from a
  runtime-owned handle rather than from the reusable definition object.
- Move generic self-scheduling guidance into the scheduling plugin's static
  configuration. Application-specific publication rules remain application
  plugin guidance.

## Implementation sequence

- [x] Add a failing integration test that creates two runtimes concurrently
      from one exported definition containing a stateful test plugin.
- [x] Add plugin definitions to the concrete agent declaration and
      `defineAgent` result.
- [x] Add typed capability requirements and runtime binding resolution.
- [x] Materialize fresh runtime plugin instances from the definition.
- [x] Move collision checks and lifecycle execution to the materialized
      instances without changing their ordering.
- [x] Remove `AgentRuntimeOptions.plugins` and update every DeepAgents caller.
- [x] Migrate `fileAgents`, `conversationScheduling`, and `schedules`.
- [x] Add namespaced runtime-context collision validation.
- [x] Update exports and API documentation.
- [ ] Publish one exact DeepAgents version containing the complete contract.

## Required verification

- Two runtimes created from one definition operate concurrently without shared
  hosts, workers, state, or disposal.
- A missing binding fails at runtime construction and names its plugin and
  capability.
- Duplicate plugin names, tools, bindings, and runtime-context namespaces fail
  deterministically.
- Plugin configuration preserves agent model, sandbox, instructions, tools,
  telemetry, and subagents unless the plugin deliberately contributes to that
  field.
- Plugin tools receive the correct conversation and agent identity.
- Initialization, work, conversation reconciliation, cancellation, and
  disposal retain their current ordering and failure behavior.
- Existing scheduling, file-agent, runtime, mailbox, approval, recovery, and
  protocol tests pass.
- A packed release installed into a clean consumer builds and passes its
  plugin integration tests without local package artifacts.

## Completion criteria

- An agent module can declare its plugins through `defineAgent`.
- `AgentRuntime` receives bindings and infrastructure, not a plugin list.
- Reusing one exported definition across runtimes is proven safe.
- Built-in plugins use the same public contract available to application
  plugins.
- The version is published and consumable from a clean install.

## Non-goals

- Dynamic plugin installation during an active conversation.
- Subagent-local runtime plugin lifecycles.
- A global plugin registry or dependency-injection container.
- JSON serialization of executable JavaScript plugin definitions.
- New before-turn or after-turn hooks without a demonstrated consumer.
