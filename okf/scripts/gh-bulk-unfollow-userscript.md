---
type: Script
title: GitHub Bulk Unfollow
description: Review everyone you follow on GitHub, then unfollow in bulk with a cap and whitelist.
repo: https://github.com/chirag127/gh-bulk-unfollow-userscript
install: https://github.com/chirag127/gh-bulk-unfollow-userscript/raw/main/gh-bulk-unfollow-userscript.user.js
version: "1.0.0"
tags: [userscript, github, unfollow, bulk]
timestamp: 2026-11-09T00:00:00Z
---

# GitHub Bulk Unfollow

Reads your following pages, builds a dry-run queue with a whitelist and hard cap, then POSTs GitHub's own unfollow form with the page `authenticity_token`.

## Method

HTML parsing of the following tab gives login plus that row's `authenticity_token`; the unfollow reuses the page's own form endpoint rather than any private API.

Endpoints:

- `GET https://github.com/<you>?page=N&tab=following` - HTML list, parsed with `DOMParser`.
- `POST https://github.com/users/<login>/unfollow` - form body `authenticity_token=`, taken from the same page's unfollow form.

## Limitations

- Following pages are parsed from HTML (`?tab=following`), 80 pages maximum.
- Unfollow is a form POST to `/users/<login>/unfollow` with the page `authenticity_token`; a stale token needs a page reload.
- Hard cap of 500 per run.
- No undo - re-following is manual and some accounts will not follow back.

## Risk

Unfollowing is immediate. A bad token can fail partway through; the log marks every failure so nothing fails silently.

## Install

Read the shared [install guide](https://github.com/chirag127/userscript-install-guide) once, then install the raw file above.
