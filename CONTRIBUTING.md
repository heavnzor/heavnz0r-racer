# Contributing

Use Node 24+, run `npm ci`, then `npm run check` and `npm test`.

Keep the core independent of a specific model provider. Changes to transitions, fingerprinting or persistence need behavioral tests against a real temporary Git repository. Tool schemas must remain compatible with both client integrations.

Describe the behavior changed and include a reproducible case. Do not commit mission state, credentials, generated worktrees or captured user prompts. For documentation and artwork, check the actual GitHub rendering and relative links.
