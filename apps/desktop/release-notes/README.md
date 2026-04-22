Create a versioned Markdown file here when you want custom updater notes.

Naming:
- `v0.1.1.md`
- `v0.1.2.md`

How it works:
- The desktop release workflow looks for `apps/desktop/release-notes/<tag>.md`.
- If the file exists, GitHub Releases uses that file as the release body.
- The in-app update popup reads those release notes and shows them under "What's new".
- If the file does not exist, the workflow falls back to GitHub's generated release notes.

Example:

```md
# KB Vault 0.1.1

## Added
- In-app update checks in Settings
- Automatic update popup with release notes

## Changed
- ACP is now the default model for new and existing workspaces

## Fixed
- Manual update checks now show clearer status messages
```
