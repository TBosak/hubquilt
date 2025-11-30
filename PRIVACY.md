# HubQuilt Privacy Policy

**Last Updated:** 2025-01-29

## Data Collection

**HubQuilt does NOT collect, transmit, or store any user data externally.**

## What Data is Stored Locally

HubQuilt stores the following data **locally in your browser only** using the browser's storage API:

1. **User Preferences**
   - Feature enable/disable settings
   - Feature-specific configuration options
   - Theme preference (light/dark/auto)

2. **Optional Personal Access Token (PAT)**
   - Stored locally using browser.storage.local
   - Only used for authenticated GitHub API requests
   - Never transmitted to any server other than GitHub's official API
   - You control when to add or remove this token

3. **Performance Cache**
   - Temporary cache of repository metadata (file sizes, tree data)
   - Used to improve performance and reduce API calls to GitHub
   - Stored locally, never sent to external servers
   - Automatically expires after a set time period

## External Communication

HubQuilt only communicates with **GitHub's official API** (api.github.com):

- Used for downloading files from repositories
- Used for fetching repository metadata
- Uses your optional PAT for authentication if provided
- No other external servers or analytics services are contacted

## Third-Party Services

- **None** - HubQuilt does not use any third-party analytics, tracking, or data collection services
- The options page loads Font Awesome icons from a CDN (CSS only, no JavaScript, verified with SRI hash)

## Permissions Explained

- **Storage** - Save your preferences and cache locally
- **GitHub Hosts** (github.com, gist.github.com, api.github.com) - Enhance GitHub pages and access GitHub's API

## Data Security

- All data is stored locally in your browser
- Your PAT is stored using the browser's secure storage API
- No data is transmitted to external servers except GitHub's API
- Extension is open source for transparency: https://github.com/TBosak/hubquilt

## Your Control

You have complete control over your data:
- Enable/disable features at any time
- Add or remove your PAT at any time
- Clear all stored data by removing the extension

## Contact

For questions about privacy, please open an issue at:
https://github.com/TBosak/hubquilt/issues

## Changes to This Policy

Any changes to this privacy policy will be posted to the GitHub repository with updated version information.
