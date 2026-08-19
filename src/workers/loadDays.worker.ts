export {};

type CompactDayFile = { date: string; dict: string[]; rows: unknown[] };

self.onmessage = async (e: MessageEvent<{ urls: string[] }>) => {
  try {
    const files: CompactDayFile[] = await Promise.all(
      e.data.urls.map(async (url) => {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) throw new Error(`Failed ${url} (${res.status})`);
        return res.json();
      })
    );
    self.postMessage({ ok: true, files });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
