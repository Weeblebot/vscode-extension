# Weeble Workspace

Edit, deploy and manage [Weeble](https://weeble.works) bots from VS Code.

## Getting started

1. Open an empty folder and select the Weeble icon in the activity bar.
2. Select **Sign In**. Approve access in your browser, or run **Weeble: Sign In with API Key** and paste a key from the dashboard's settings.
3. Select **Select Deployment**. The deployment's files are downloaded into the folder.
4. Edit, then select the rocket button to deploy.

## What's where

- **Status bar:** the deployment and its live revision. Select it for Deploy, Runtime Logs, Select Deployment, Set Entrypoint and the rest.
- **Revisions:** every published revision, newest first. Expand one to see the files it changed. Right-click to activate, compare with your files, or restore it.
- **KV:** your deployment's KV data by namespace. Select a key to edit it as JSON; saving writes it back.
- **Packages:** the npm packages in `package.json`. Use **+** to add an approved package, or right-click **Packages** to request one. **My Requests** shows what you've asked for.
- **Weeble Runtime** output: your bot's console, streamed while **Runtime Logs** is on.
- **Weeble** output: deploy steps and extension messages. Build errors also go to the **Problems** panel.

## SDK types

When a newer SDK is published, the extension offers to update the declarations in `.weeble/types`. It never changes your source or dependencies. **Weeble: Check for SDK Updates** checks on demand.

A major release, such as 2.x to 3.0, can break existing scripts. The extension warns about those and offers the release notes first, so you can see what to change before updating.

## Snippets

Type the prefix in a `.ts` or `.js` file:

| Prefix | Inserts |
| --- | --- |
| `wb-commands` | The command application every command registers on |
| `wb-slash` | A slash command with one option |
| `wb-prefix` | A prefix command |
| `wb-on` | An event handler |
| `wb-kv` | A KV namespace with typed get and put helpers |
| `wb-cron` | A recurring task |

## Settings

| Setting | Default |
| --- | --- |
| `weeble.apiUrl` | `https://api.weeble.works` |
| `weeble.buildServiceUrl` | `https://build.weeble.works` |

Runs in desktop VS Code and in the browser (vscode.dev, github.dev).
