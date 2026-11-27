# Posts

Every file in this folder named `YYYY-MM-DD-slug.md` is published at
`/posts/slug`, listed on `/posts`, in the RSS feed (`/posts/rss.xml`) and in
the sitemap, and the site's header and footer link to Posts once there is
one. Nothing else is read: this file, subfolders and links to files elsewhere
are left out. A post is published when its file is merged and the playground
is deployed.

A post starts with front matter:

```markdown
---
title: What an approval is
subtitle: Why a change waits for the person, and what they see.
date: 2026-12-01
tags: [approvals, operations]
learn: /learn/operations
---

The text, in Markdown, rendered as Learn's pages are.
```

- `title` is required. `date` is optional and, when given, must be the date
  in the file's name.
- `learn` is a Learn page that goes deeper, linked under the post.
- `canonical` is the original's address, only for a post first published
  somewhere else. Without it the post's own address is canonical, so a copy
  imported elsewhere (Medium's "Import a story") credits this one.
- A heading `# ...` at the top is dropped: the page shows `title`.

Links work on GitHub and on the site alike: a relative link to a Learn file
(`../../../../docs/learn/operations.md`) becomes `/learn/operations`, a link
to a file in the repository goes to GitHub, and `/playground` stays as it
is. An image belongs under `apps/playground/public/`, linked by its relative
path (`../../public/posts/name.png`).

The posts form one series in date order: each ends with links to the
previous and the next.
