# GitHub Bulk Unfollow

Review everyone you follow on GitHub, then unfollow in bulk with a cap and whitelist.

## What it does

Reads your following pages, builds a dry-run queue with a whitelist and hard cap, then POSTs GitHub's own unfollow form with the page `authenticity_token`.

## Install

Read the shared **[userscript install guide](https://github.com/chirag127/userscript-install-guide)** once (ScriptCat / Tampermonkey setup), then install:

**[Install gh-bulk-unfollow-userscript.user.js](https://github.com/chirag127/gh-bulk-unfollow-userscript/raw/main/gh-bulk-unfollow-userscript.user.js)**

## Use

1. Open github.com signed in and press **Alt+Shift+F** (panel is on the top right).
2. Set the cap and whitelist, then press **Scan following**.
3. Review the queue, untick anyone to keep, then press **Unfollow N** once to confirm.
4. Watch the per-login status column; **Pause** / **Stop** work mid-run.

Everything runs in a floating panel: drag it by the header, resize from the corner, collapse it to a chip. The dry run always comes first; exactly one confirm starts the work.

## Limits

- Following pages are parsed from HTML (`?tab=following`), 80 pages maximum.
- Unfollow is a form POST to `/users/<login>/unfollow` with the page `authenticity_token`; a stale token needs a page reload.
- Hard cap of 500 per run.
- No undo - re-following is manual and some accounts will not follow back.

## Risk note

Unfollowing is immediate. A bad token can fail partway through; the log marks every failure so nothing fails silently.

The script acts with your own signed-in session against your own account. It is not an anti-bot bypass - it uses the same endpoints the site's own page uses.

## Documentation

- [AGENTS.md](AGENTS.md) - implementation notes and test steps
- [okf/](okf/index.md) - knowledge bundle for humans and agents

## License

[MIT](LICENSE) (c) 2026 chirag127
