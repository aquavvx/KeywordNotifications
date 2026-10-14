# Keyword Notifications

Snow/Bunny plugin that shows an in-app toast when a loaded Discord message
contains one of your configured keywords. Alerts use a highlighted, Discord-style
toast with a glow accent.

Install from:

`https://raw.githubusercontent.com/aquavvx/KeywordNotifications/main/manifest.json`

Configure comma-separated keywords in the plugin settings, for example:

`urgent, commission, meeting`

To send alerts to Discord, copy the target channel ID from Discord's channel
context menu, enter it in the plugin settings, and press **Create webhook**.
You need permission to manage webhooks in that channel. Matching messages are
sent as an embed through the created webhook.

This first version watches message data returned while Discord loads channels,
search results, or message history. It does not provide notifications while
Discord is fully closed. Webhook forwarding is optional and only occurs after
you create and enable a webhook in the plugin settings.
