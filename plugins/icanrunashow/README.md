# I Can Run A Show

Run your comedy, drag, burlesque and variety shows by asking Claude for what you need in plain words. This plugin connects Claude to your [I Can Run A Show](https://icanrunashow.com) account, so it can read and edit your shows, lineups and running orders, keep your Rolodex up to date, fill in recaps, check which contracts have come back, and make profile and contract links for you to share.

## What's in it

- **The I Can Run A Show connector**: the app's own remote MCP server at `https://icanrunashow.com/api/mcp`. It has no local code and runs nothing on your computer.
- **The run-a-show skill**: short guidance for the assistant. It follows what you ask, reads a show before changing it, checks with you once before deleting, removing or making a link, keeps surprise guests off anything public unless you say to name them, and treats dates and times as the venue's local time.

## Install in Claude

On claude.ai and in the Claude desktop app, add it from the plugin directory.

In Claude Code:

```
/plugin install icanrunashow --marketplace taylordrew4u2/showrunner-icanrunashow
```

To add just the connector, without the skill, open **Customize → Connectors** ([claude.ai/customize/connectors](https://claude.ai/customize/connectors)), choose **Add custom connector** and paste `https://icanrunashow.com/api/mcp`.

## Getting started

1. Install the plugin, then connect the I Can Run A Show connector when Claude asks. In Claude Code, run `/mcp`, choose `icanrunashow` and authenticate.
2. Sign in on the app's own page at icanrunashow.com. Claude never sees your password.
3. Untick anything you don't want to allow, then press **Allow access**.
4. Ask away: "What's on my lineup for Friday's show, in running order?"

You need an I Can Run A Show account. Sign up at [icanrunashow.com](https://icanrunashow.com).

## Permissions

Seeing your shows is always included. Editing shows, moving shows to Trash, seeing or editing the Rolodex, seeing contracts and the contact details performers gave, and making links are each a separate permission you can untick when you connect. For a contract or profile link that has come back, the assistant sees which questions were answered and the performer's email, phone, social handle, bio and walk-on song; their other answers stay in the app. The assistant is offered only the tools you allowed, and the server refuses anything else.

## What it sends and where

The plugin talks only to `icanrunashow.com`. When you connect, your browser gives the app's server your account's data keys, locked under that connection's own credentials, so the server can read and save what each request needs while your assistant is calling it. Whatever a tool returns goes to your assistant's provider and is handled under their terms. Nothing contacts performers: a link the assistant makes is returned to you to share. Disconnect at any time from **Settings → AI assistants** in the app; connections also end after 30 days.

## Other assistants

The same plugin works in ChatGPT and Codex.

- **ChatGPT**: add it from the plugin directory, or add just the connector: go to [chatgpt.com/plugins](https://chatgpt.com/plugins), choose **+**, then **Add custom MCP server**, paste `https://icanrunashow.com/api/mcp` with OAuth authentication, and choose **Create as a plugin**.
- **Codex**: run

  ```
  codex plugin marketplace add taylordrew4u2/showrunner-icanrunashow
  ```

  then install `icanrunashow` from that marketplace.

## More

- Guide: [Run your shows from Claude or ChatGPT](https://icanrunashow.com/guides/ai-assistants.html)
- Privacy policy: [icanrunashow.com/privacy.html](https://icanrunashow.com/privacy.html)
- Terms: [icanrunashow.com/terms.html](https://icanrunashow.com/terms.html)
- Support: [skatematesnyc@gmail.com](mailto:skatematesnyc@gmail.com)
