# Start, stop and troubleshoot

[README](../README.md) · [User guide](user-guide.md)

## Source checkout

Use Node.js 22+. Run `npm start` and open the printed loopback URL. The launcher waits for readiness, detaches the server and reuses a matching instance. macOS also has `start.command`; Windows has `start.cmd` with native acceptance still in progress.

Source launchers store data in the checkout's `data/`. Stop the printed PID with `kill PID` on macOS/Linux or `Stop-Process -Id PID` in PowerShell. Start again after a computer restart. For development, `node server.mjs` runs in the foreground; Ctrl+C stops it.

## Packaged CLI

Install the [GitHub beta archive](https://github.com/maruthiprithivi/harness-desk/releases/tag/v0.1.0-beta.1) using the README command. GitHub Releases is the distribution channel; npm installs the archive directly without an npm registry release.

```sh
harness-desk start
harness-desk status
harness-desk stop
harness-desk --help
```

CLI data lives in `~/.harness-desk`, separate from the installation. Use the same installed copy and options for start, status and stop:

```sh
harness-desk start --port 4320 --data-dir ./private-harness-data
harness-desk status --port 4320 --data-dir ./private-harness-data
harness-desk stop --port 4320 --data-dir ./private-harness-data
```

`PORT` and `HARNESS_DATA_DIR` are environment-variable alternatives; flags take priority. Keep custom data directories out of Git. Stopping preserves data. There is no automatic start at login.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Connection refused | Run the launcher; inspect its printed startup log if readiness fails. |
| Port occupied | Choose another port or stop its owner. |
| Data directory in use | Stop the owner; changing ports does not allow two writers. |
| Startup lock persists | Confirm no startup is active; inspect the reported `runtime/startup-lock` before manual recovery. |
| Stop cannot confirm ownership | Check installation, port and data directory; no mismatched process is signaled. |

Logs live at `runtime/server.log` beneath the selected data directory. Dead PID locks recover on launch; interrupted startup guards require inspection. Retention does not archive operational logs.

Changing data directories selects another workspace rather than migrating records. Stop the app and preserve a copy before manually moving data.
