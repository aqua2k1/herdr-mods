# Subscriptions integration

Subscriptions is a status-bar button (icon + label) that opens a floating detail panel. The old Files/Changes side-panel presentation and `subscriptions.open` event integration have been removed.

Follow [status-bar integration](STATUSBAR.md) for installation and migration. Existing side-panel installations must remove their Subscriptions panel child and tabs integration; leave Files/Changes untouched. No `presentation` prop is required.
