# Context Index

| File | What | When to read |
|------|------|--------------|
| commands.md | `pnpm dev/build/test/lint`, `m chunks` semantic search (2160 TS+298 docs), `clawdbot memory search` with Gemini embeddings | Before running builds, searching code, or querying memory |
| gotchas.md | `memory index` not `sync`, Node 22+ required, Gemini asyncBatch broken (use sync), spec verify Python-only, gateway auth tokens must match, pairing CLI lazy-loads channels | Before touching memory indexing, gateway config, or CLI commands |
