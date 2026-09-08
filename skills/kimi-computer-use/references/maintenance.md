# App and skill maintenance

Use this runbook when upgrading Kimi Computer Use. Maintain the skill in `adonis-skills/skills/kimi-computer-use/`; synchronize installed copies after source validation. Use an existing authorized scheduled updater where present, rather than creating another schedule.

## Check and upgrade

1. Record the installed app version, signature/Gatekeeper result, `service-status`, and `xpc-ping`. Identify the actual skill source and intended host entrypoints; preserve focused source changes before editing.
2. Use the signed app's official upgrade command:

   ```bash
   /Applications/KimiCU.app/Contents/MacOS/kimi-cu upgrade </dev/null
   ```

   EOF prevents an unattended prompt from hanging; it is not consent. Handle account login or macOS permission prompts through the user when required. Do not install a reposted binary or repeatedly reinstall a healthy service to repair a host connection.

3. Recheck the bundle version, signature, Gatekeeper, service registration and permissions. `xpc-ping` is the permission source of truth. If verification fails, report the failing layer and retain evidence before selecting an official recovery path.

## Prove the new session

1. Open a fresh MCP session with the registered command. Compare the `initialize` server version with the installed bundle version. Discover the live tool schema, then complete `list_apps` and `get_app_state(app=com.apple.finder, mode=ax)`.
2. Treat `Transport closed` on an old connection after upgrade as a reason to reconnect the affected host. Do not mass-kill other hosts' processes, rewrite working registrations or bypass permissions.
3. A standalone stdio check proves that server session only. For each host in the requested acceptance scope, distinguish skill discovery, MCP connection, tool discovery, completed model tool calls and old-session recovery. Use [host-configs.md](host-configs.md) only for the relevant host. Mark untested layers `UNVERIFIED`.
4. Preserve each host's preferred native Computer Use and model. Explicitly requested Kimi smoke tests can use Kimi; they do not make it the global default. Real pointer/keyboard actions across AI hosts still share one desktop and must be serialized.

## Deliver and record

Run `pnpm skills:finalize -- skills/kimi-computer-use` from the source repository when skill content changes. Synchronize intended host entrypoints, compare installed file contents, and run the installation manager's source-classification check when applicable. A readable symlink does not prove an existing session loaded the new instructions.

Save a bounded report outside public skill source with old/new versions, rule hashes, host/model when known, verification outcomes, changed files and recovery needs. Do not retain app inventories, window contents or credentials. Reuse the existing scheduler; scheduled exit success is not proof of all-host model acceptance. Commit or push only when requested.
