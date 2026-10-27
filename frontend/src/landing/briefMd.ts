export type Block =
  | { t: "h1"; text: string; id: string }
  | { t: "h2"; text: string; id: string }
  | { t: "h3"; text: string; id: string }
  | { t: "dek"; text: string }
  | { t: "byline"; text: string }
  | { t: "p"; text: string }
  | { t: "hr" }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "table"; heads: string[]; rows: string[][] }
  | { t: "code"; lang: string; body: string }
  | { t: "img"; src: string; alt: string; caption?: string };

export function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
}

export function parseBrief(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  const peek = () => lines[i] ?? "";
  const take = () => lines[i++] ?? "";
  let front = true;

  while (i < lines.length) {
    const line = peek();
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const body: string[] = [];
      while (i < lines.length && !peek().startsWith("```")) body.push(take());
      if (peek().startsWith("```")) i++;
      out.push({ t: "code", lang, body: body.join("\n") });
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      const n = line.startsWith("###") ? 3 : line.startsWith("##") ? 2 : 1;
      const text = line.replace(/^#{1,3} /, "").trim();
      const t = n === 1 ? "h1" : n === 2 ? "h2" : "h3";
      out.push({ t, text, id: slug(text) });
      if (t !== "h1") front = false;
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push({ t: "hr" });
      front = false;
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && peek().startsWith("|")) {
        const cells = take()
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (cells.every((c) => /^[-:]+$/.test(c))) continue;
        rows.push(cells);
      }
      const heads = rows.shift() ?? [];
      out.push({ t: "table", heads, rows });
      continue;
    }
    if (line.startsWith("![") ) {
      const m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      i++;
      let caption: string | undefined;
      while (i < lines.length && peek().trim() === "") i++;
      const next = peek().trim();
      if (next.startsWith("*") && next.endsWith("*") && !next.startsWith("**")) {
        caption = next.slice(1, -1);
        i++;
      }
      if (m) out.push({ t: "img", alt: m[1] ?? "", src: m[2] ?? "", caption });
      continue;
    }
    const trimmed = line.trim();
    if (front && /^\*\*.+\*\*$/.test(trimmed) && trimmed.indexOf("**", 2) === trimmed.length - 2) {
      out.push({ t: "dek", text: trimmed.slice(2, -2) });
      i++;
      continue;
    }
    if (front && /^\*[^*].+\*$/.test(trimmed) && !trimmed.startsWith("**")) {
      out.push({ t: "byline", text: trimmed.slice(1, -1) });
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(peek())) items.push(take().replace(/^[-*] /, ""));
      out.push({ t: "ul", items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(peek())) items.push(take().replace(/^\d+\. /, ""));
      out.push({ t: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && peek().trim() !== "" && !/^(#{1,3} |```|---+\s*$|\||!\[|[-*] |\d+\. )/.test(peek())) {
      buf.push(take());
    }
    if (buf.length) out.push({ t: "p", text: buf.join(" ") });
  }

  return out;
}

export function tocOf(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { t: "h2" }> => b.t === "h2");
}

export function assetSrc(src: string) {
  const file = src.replace(/^assets\//, "");
  return `/brief-assets/${file}`;
}
