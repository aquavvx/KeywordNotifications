# Keyword Notifications

Snow/Bunny plugin that shows an in-app toast when a loaded Discord message
contains one of your configured keywords.

Install from:

`https://raw.githubusercontent.com/aquavvx/KeywordNotifications/main/manifest.json`

Configure comma-separated keywords in the plugin settings, for example:

`urgent, commission, meeting`

This first version watches message data returned while Discord loads channels,
search results, or message history. It does not provide notifications while
Discord is fully closed, and it does not upload message content anywhere.
