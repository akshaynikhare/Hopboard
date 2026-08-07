# cli/

RealtimeClipboard on the command line — the same crypto and the same protocol as the browser, because
it imports the same modules.

```bash
npx realtimeclipboard new              # print a fresh key
npx realtimeclipboard <KEY>            # two-way: prints what arrives, sends what you type
npx realtimeclipboard watch <KEY>      # print incoming clips and nothing else
npx realtimeclipboard send <KEY>       # read stdin to EOF, send it, exit
```

Built for pipes — clip content is the only thing on stdout, and the exit code is what a script
should branch on:

```bash
tail -f app.log | npx realtimeclipboard send WORK5
npx realtimeclipboard watch WORK5 > incoming.txt
```

Needs Node 22+, for the global `WebSocket`, `fetch` and `crypto.subtle` that let it share the
browser's transport and crypto unchanged.

Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
