# Disabling Registration

It is highly recommended to disable new user registration when it is not needed.

Making a mistake while setting up a deployment of ExoServe could lead to unwanted persons registering a new account. If a new account can be registered, the obvious danger is that the user could potentially fill up all available disk space.

The more subtle danger is that the vast majority of interactions with the server require authentication; if a nefarious actor can create an account, their attack surface is greatly increased.

The process to toggle user registration can be completed in seconds:

1. Log in to an existing user account.
1. Navigate to the settings page.
1. Find System Configuration > Account Registration.
1. (Un)check the "Allow new users to register" box.
1. Scroll to the bottom of the page.
1. Click the "Save Changes" button.

When registration is disabled:

- **Client-side**: The message to sign up for a new account will no longer be visible. Navigating to the signup page manually will indicate that registering new user accounts has been disabled.
- **Server-side**: Attempting to manually make the request to register a new user account will be rejected by the server.