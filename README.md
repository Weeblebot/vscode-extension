# Weeble for VS Code

The [Weeble](https://weeble.works) extension for VS Code: edit, deploy and manage Weeble scripts without leaving your editor. Install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Weeble.weeble), or read [how to use it](https://weeble.works/docs/editing.html#in-vs-code).

This repository holds version 1.0.0 of the extension and the packages it is built from:

| Folder | What it is |
| --- | --- |
| `packages/vscode-extension` | The extension |
| `packages/api-client` | A typed client for the Weeble API |
| `packages/project` | Which files in a folder make up a Weeble script |
| `packages/types` | The Weeble SDK declarations, also published as [weeble-sdk-types](https://github.com/pimarawan/weeble-sdk-types) |

## Building

You need Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm test
pnpm package
```

`pnpm package` writes a `.vsix` you can install with **Extensions: Install from VSIX…**.

## Contributing

The code here is copied from Weeble's main repository on each release, so changes are made there. Bug reports and suggestions are welcome as [issues](https://github.com/Weeblebot/vscode-extension/issues). To report a security problem, use [private vulnerability reporting](https://github.com/Weeblebot/vscode-extension/security) instead of an issue.

## License

[MIT](LICENSE)
