# Conversation Rating Dashboard

Analytics UI for conversation rating CSV/HTML exports. Upload report files in the browser, or ship them with the deployed site so they load automatically.

## Local development

```bash
npm install
npm run dev
```

Drop CSV/HTML files into `public/data/` to test auto-load locally (run `node scripts/generate-data-manifest.mjs` or `npm run build` to refresh the manifest).

## Bundled data on deploy (no manual upload)

The dashboard is a static site (GitHub Pages). To pre-load reports on the deployed URL:

1. **Add files to the repo** — copy rating CSVs or HTML exports into `public/data/` (one file per day/period works best for timeline charts).
2. **Build** — `npm run build` scans `public/data/` and writes `public/data/manifest.json` listing every `.csv` / `.html` file.
3. **Deploy** — push to `main`; the GitHub Actions workflow builds and publishes the site with those files included.
4. On open, the app fetches the manifest and loads each listed file automatically.

Optional: append `?data=extra.csv` or `?data=https://example.com/report.csv` to the URL to load additional files (comma-separated). Same-origin and CORS-enabled URLs work.

### CI: fetch data at build time (keep CSVs out of git)

If reports live elsewhere (S3, GCS, another repo), add a step before `npm run build` in `.github/workflows/deploy.yml`:

```yaml
- name: Fetch rating exports
  run: |
    mkdir -p public/data
    curl -fsSL -o public/data/day1.csv "$REPORT_URL_1"
    # manifest is regenerated during npm run build
```

Store URLs or credentials in GitHub Actions secrets.

## Deploy (GitHub Pages)

1. Create a GitHub repo named **`conversation-rating-dashboard`** (name must match `repoName` in `vite.config.ts`).
2. Push this folder to the `main` branch.
3. Repo **Settings → Pages → Source**: **GitHub Actions**.
4. After the workflow succeeds, open `https://<your-username>.github.io/conversation-rating-dashboard/`.

If you use a different repo name, update `repoName` in `vite.config.ts` and push again.
