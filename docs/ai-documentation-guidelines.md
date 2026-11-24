# Documentation guidelines for AI contributors

Keep the repository documentation accurate, useful, and easy to maintain. Write for the person using or contributing to Dawg Viewer, not as a record of the coding session.

## When to update documentation

Update docs when a change affects user-visible behavior, setup, configuration, device or file compatibility, architecture, development commands, testing, or release operations. A code-only refactor usually needs no documentation change unless it changes a documented boundary or constraint.

## Where information belongs

- `README.md`: project summary, key capabilities, quick start, and links.
- `CONTRIBUTING.md`: contribution workflow and a short pointer to deeper guidance.
- `docs/user-guide.md`: instructions for using the application.
- `docs/configuration.md` and `docs/device-protocol.md`: configuration and compatibility references.
- `docs/architecture.md`, `docs/backend.md`, and `docs/frontend.md`: system design and implementation ownership.
- `docs/development.md`: toolchain, commands, tests, CI, builds, and releases.
- `docs/README.md`: navigation to maintained documents.

Keep each fact in one primary location and link to it elsewhere. Do not create branch snapshots, duplicate feature lists, or session-by-session change logs as durable documentation.

## Writing and accuracy

- Treat implementation, tests, checked-in defaults, and CI workflows as the source of truth. Inspect the relevant files before changing a claim.
- Describe behavior that exists in the checked-out code. Label genuine limitations clearly; do not present plans or assumptions as implemented features.
- Use direct, specific language and short paragraphs. Prefer concrete examples when they help someone complete a task.
- Avoid dated measurements, machine-specific details, and version numbers that will quickly go stale unless they are necessary evidence. State the environment and method when reporting measurements.
- Keep examples valid and internally consistent with current defaults and supported formats.
- Preserve compatibility details that users or device authors rely on. Explain behavior changes that affect existing configurations, logs, or workflows.
- Do not add explanatory comments to code as a substitute for user or contributor documentation.

## Before finishing

- Check that each edited claim matches its source in code, tests, defaults, or workflow configuration.
- Update the documentation index and cross-links when adding, renaming, or removing a guide.
- Remove stale links and references when deleting or moving documentation.
- Review the final prose for duplication, branch-specific phrasing, unexplained jargon, and unnecessary implementation history.
