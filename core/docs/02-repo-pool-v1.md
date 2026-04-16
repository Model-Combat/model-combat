# Repo Pool v1

## Pool policy

The pool is intentionally small. V1 prioritizes reliable adapters and repeatable round generation over raw breadth.

### Admission rules

Accept only services that are:

- self-hostable,
- permissively licensed,
- meaningfully multi-user or multi-tenant,
- operationally simple enough for repeated EC2 preflight,
- rich enough for natural `check`, `put_flag`, and `get_flag` scripts.

Reject services that are:

- AGPL, GPL-only, or otherwise incompatible with private live rounds,
- archived or effectively abandoned,
- too infrastructure-heavy for seeded-round generation,
- too single-user to make cross-tenant leaks meaningful.

## Sampling model

Do not sample three repos from one flat list. Sample exactly one service from each bucket:

- `knowledge`
- `stateful-utility`
- `realtime-collab`

This prevents low-diversity rounds and improves coverage of different exploit and patching patterns.

## Active pool

| Repo | Bucket | Core reasons | Adapter shape | Sources |
|---|---|---|---|---|
| BookStack | knowledge | Roles, shelves, pages, revisions, attachments, authz-heavy content graph | create private page or attachment under user A, fetch as owner | [BookStack](https://github.com/BookStackApp/BookStack) |
| Memos | knowledge | Notes/resources with clear ownership boundaries and API support | create private memo or resource, fetch as owner | [Memos](https://github.com/usememos/memos) |
| Linkding | knowledge | Bookmark manager with notes, tags, archive state, sharing, REST API | create bookmark with private metadata, fetch as owner | [Linkding](https://github.com/sissbruecker/linkding) |
| File Browser | stateful-utility | Filesystem-backed multi-user data, upload/edit/download flows, simple runtime | upload flag file into user directory, fetch as owner | [File Browser](https://github.com/filebrowser/filebrowser), [CLI docs](https://filebrowser.org/cli/filebrowser-users.html) |
| Gogs | stateful-utility | Full Git service with private repos, issues, wiki, assets, API | create private issue, wiki page, or asset; fetch as owner | [Gogs](https://github.com/gogs/gogs), [API docs](https://github.com/gogs/docs-api) |
| Miniflux | stateful-utility | Feed polling pipeline, per-user state, categories, bookmarks, API | use judge-hosted feed fixture, publish feed entry, force refresh, fetch as owner | [Miniflux](https://github.com/miniflux/v2) |
| Etherpad Lite | realtime-collab | Shared-state editor with group/session API and plugin surface | create group pad, write flag, fetch via API as authorized user | [Etherpad Lite](https://github.com/ether/etherpad-lite) |
| Gotify | realtime-collab | User/app/message model with REST and websocket access | publish app/user message, fetch with valid token | [Gotify](https://github.com/gotify/server) |
| ntfy | realtime-collab | Simple topic ACL model with push/pull semantics, easy to script | publish to authenticated private topic, retrieve as owner | [ntfy](https://github.com/binwiederhier/ntfy) |
| Wekan | realtime-collab | Board/list/card/comment/attachment model with team separation | create card/comment/attachment in private board, fetch as owner | [Wekan](https://github.com/wekan/wekan) |

## Repo-specific adapter notes

### BookStack

- Good candidate for authz, object reference, attachment, and search leakage bugs.
- Adapter should prefer API paths over browser automation when possible.
- Seed models should avoid bugs that require admin-only access to trigger.

### Memos

- Strong fit for private-resource leakage, IDOR, and visibility-state mistakes.
- Adapter should exercise both memo text and resource attachment paths.

### Linkding

- Good for shared-vs-private bookmark leakage and archive/note metadata exposure.
- Adapter should keep payloads small and purely API-driven.

### File Browser

- Ideal for path traversal, symlink, preview, share, and permission-boundary bugs.
- Adapter must pin root directory layout so paths are deterministic.

### Gogs

- Offers diverse data surfaces: repos, issues, wiki, assets, orgs.
- Adapter should standardize on one or two data placements to keep checkers deterministic.

### Miniflux

- Special-case service because `put_flag` depends on a feed refresh loop.
- The judge must host the feed fixture and expose per-team feed URLs.
- Qualification threshold should be stricter because poll timing can create flake.

### Etherpad Lite

- Realtime service with shared document state and session controls.
- Adapter should avoid brittle UI automation and use the HTTP API wherever possible.

### Gotify

- Supports message and app token workflows well suited to simple deterministic checkers.
- Adapter should pin one application per team user.

### ntfy

- Use only when the deployed version remains permissively licensed under the chosen release policy.
- Qualification should explicitly test ACL enforcement and retained-message behavior.

### Wekan

- Rich collaborative object graph makes it good for access-control leakage.
- Adapter should create one private board and keep all flag-bearing objects under that board.

## Deferred pool

- Gitea
- PocketBase
- YOURLS
- Shiori

These remain reserve candidates for v2 after the judge and adapters stabilize.

## Excluded pool

- Opengist
- Wiki.js
- Plane
- Formbricks
- Gokapi
- listmonk
- Appwrite

The first group conflicts with private-live-round license constraints. Appwrite is excluded because it is too infrastructure-heavy for v1 round generation.

## Qualification bar

Before a repo can be activated:

- its adapter must pass 100 consecutive local `check`, `put_flag`, `get_flag` cycles,
- seeded issues must reproduce at least 4 times out of 5,
- the service must tolerate clean restart cycles without manual intervention,
- the service must expose a single canonical entrypoint and fixed port mapping.
