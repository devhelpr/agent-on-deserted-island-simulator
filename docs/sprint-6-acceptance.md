# Milestone 6 acceptance

Implemented three-agent Codex experiments with separate threads, identity-bound world tools, durable per-agent memory, explicit communication, fixed-world cycles, bounded decision attempts, automatic completion, usage accounting, historical timelines, and cycle comparison.

## Experiment lifecycle and budgets

The creation API accepts `experiment: { maxCycles, decisionBudgetPerAgentPerCycle }`. Both values are validated and stored with the run configuration. Attempts are recorded before model work begins; failures and cancellations count. Recovery reconstructs consumed budgets from durable decisions. Each agent's last budgeted in-flight turn can finish, while further turns are refused. Exhausted agents leave the decision barrier and the world continues to its cycle boundary. Budgets reset for the next cycle. Final consolidation and a final replay snapshot are retained; the last configured cycle stops without creating a phantom next cycle. Manual resets count as cycles and have a distinct stored outcome. Existing API runs without experiment configuration preserve their previous continuous lifecycle.

Communication uses the existing 25 m, 120° visibility and occlusion rules, with validation again at execution. Explicit delivered messages retain text, sender, recipient, tick, and action ID in the durable event history. Only sender and recipient receive the speech event in their observations. Automatic greetings remain separate. Shared ownership remains centrally validated and deterministic.

## Metrics and dashboard

Live, Timeline, Memory, Replay, and Experiment tabs expose runtime progress and historical comparisons. Timeline reads up to 200 durable events per sequence cursor, scoped to one run and cycle. Experiment reports per-agent decision attempts, failures, cancellations, tool calls, decision wall time, unique observed objects, revisits of previously observed objects, decision-sampled 25 m cells, explicit delivered messages, and objects successfully interacted with by multiple agents in one cycle.

Memory metrics count successful movement to supplied targets from earlier cycles. This is observable behavioral evidence, not access to private reasoning. Location checks compare retrieved claims' source observations with later visible objects, with a 10 cm tolerance; no check means unknown. Object movement can invalidate an old location without implying a model error. Token costs are unavailable and are not estimated.

Replay serialization now caches pure canonical field values to avoid repeatedly sorting unchanged entities and histories. Its patch base still comes from the durable database, so rolled-back writes cannot poison reconstruction. Existing complete-cycle hash and transaction tests pass.

## Validation

`npm run typecheck`, `npm test` (74 tests in 16 files), and `npm run build` pass. The deterministic endurance test runs **two complete 72,000-tick cycles**, automatically resets, proves successful memory-target movement by all three agents in cycle two, checks agent memory isolation, six consolidations, budget limits, final stopping, and replay reconstruction of both final checkpoints. Additional regressions cover failed attempts, budget recovery, completed-run recovery, invalid configuration, history scoping/cursors, private speech, reported memory, shared object metrics, and completion of the last budgeted asynchronous Codex turn.

Browser verification used a temporary database. It covered configuring a bounded run, visible budgets, reset and comparison between two cycles, terminal stopping, and the persistent historical Timeline. Existing user runs were not used for test mutations.

A real Codex run also met **S6.7: complete first cycle, reset, and demonstrated memory use in cycle two**. See [recorded live evidence](sprint-6-live-result.json). Three independent first-cycle threads were replaced by three fresh second-cycle threads. All agents completed successful moves to earlier memory targets: Alpha 1, Beta 2, Gamma 2. Three explicit messages and a shared Beta/Gamma object interaction were recorded. First-cycle discoveries were 17/19/19 unique objects; second-cycle revisits were 6/14/11. Location checks confirmed 3/5/6 retrieved claims, with no observed contradictions.

The live run was stopped after collecting acceptance evidence at second-cycle tick 23,055; it did **not** complete a second full cycle. The report was evaluated read-only from committed SQLite records after stopping the runner. Two full cycles and automatic final termination are proven by the deterministic test. The repeatable `npm run verify:experiment` now stops automatically once the full first cycle and all three agents' second-cycle memory evidence are present. It permits at most 48 model attempts and has a ten-minute wall deadline. Requested acceleration can be lower in practice under persistence or model load; virtual ticks are not skipped. Errors and unsuccessful world actions remain in the history rather than being hidden.
