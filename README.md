# Conversation Rating Dashboard

Analytics UI for conversation rating CSV/HTML exports. Upload report files in the browser — nothing is sent to a server.

## Local development

```bash
npm install
npm run dev
```

## Deploy (GitHub Pages)

1. Create a GitHub repo named **`conversation-rating-dashboard`** (name must match `repoName` in `vite.config.ts`).
2. Push this folder to the `main` branch.
3. Repo **Settings → Pages → Source**: **GitHub Actions**.
4. After the workflow succeeds, open `https://<your-username>.github.io/conversation-rating-dashboard/`.

If you use a different repo name, update `repoName` in `vite.config.ts` and push again.
