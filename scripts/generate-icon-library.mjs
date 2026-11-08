#!/usr/bin/env bun
/**
 * generate-icon-library.mjs
 *
 * Generates the local, offline-first Velnox icon library from the official
 * Iconify JSON packages (@iconify-json/*). Nothing here is fetched at runtime;
 * the generator is a build/development-time step that turns the installed
 * collection packages into compact, per-collection JSON assets committed to
 * the repository.
 *
 * Outputs (under packages/shared/src/lib/icons/generated/):
 *   manifest.json   — collection metadata (prefix, name, total, license,
 *                     author, samples, height) for icon-collections/registry.
 *   names/<prefix>.json    — flat array of every icon + alias name (search).
 *   icons/<prefix>.json    — { [name]: { body, w?, h? } } SVG body data needed
 *                     to render that icon offline.
 *
 * Run:  bun scripts/generate-icon-library.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages/shared/src/lib/icons/generated");

// Collection slug -> installed @iconify-json package name.
const COLLECTIONS = {
  lucide: "@iconify-json/lucide",
  mdi: "@iconify-json/mdi",
  tabler: "@iconify-json/tabler",
  ph: "@iconify-json/ph",
  "fa6-solid": "@iconify-json/fa6-solid",
};

function readPackageJson(pkg) {
  return JSON.parse(
    readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8"),
  );
}

function readIconsJson(pkg) {
  return JSON.parse(
    readFileSync(join(ROOT, "node_modules", pkg, "icons.json"), "utf8"),
  );
}

function readInfoJson(pkg) {
  const p = join(ROOT, "node_modules", pkg, "info.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "names"), { recursive: true });
  mkdirSync(join(OUT, "icons"), { recursive: true });

  const manifest = [];

  for (const [slug, pkg] of Object.entries(COLLECTIONS)) {
    const data = readIconsJson(pkg);
    const info = readInfoJson(pkg);
    const pkgJson = readPackageJson(pkg);

    // All icon names + aliases. Aliases point at a parent icon; keep them for
    // search and name resolution (an alias renders its parent's body).
    const names = [
      ...Object.keys(data.icons ?? {}),
      ...Object.keys(data.aliases ?? {}),
    ].sort();

    // Compact icon body map. `w`/`h` stored only when they differ from the
    // collection default so the asset stays small.
    const defaultH = info?.height ?? data.height ?? null;
    const icons = {};
    for (const [name, icon] of Object.entries(data.icons ?? {})) {
      const rec = { body: icon.body };
      if (icon.width != null && icon.width !== defaultH) rec.w = icon.width;
      if (icon.height != null && icon.height !== defaultH) rec.h = icon.height;
      icons[name] = rec;
    }
    // Alias entries reference a parent name; the loader resolves them to the
    // parent's body at render time.
    const aliases = {};
    for (const [name, alias] of Object.entries(data.aliases ?? {})) {
      aliases[name] = alias.parent;
    }

    const collection = {
      prefix: data.prefix ?? slug,
      name: info?.name ?? pkgJson.name ?? slug,
      total: Object.keys(data.icons ?? {}).length,
      aliases: Object.keys(aliases).length,
      height: defaultH,
      version: info?.version ?? null,
      license: info?.license ?? null,
      author: info?.author ?? null,
      samples: info?.samples ?? null,
    };

    manifest.push(collection);

    writeFileSync(join(OUT, "names", `${slug}.json`), JSON.stringify(names));
    // Icon body data PLUS the alias→parent map, loaded together on demand.
    writeFileSync(join(OUT, "icons", `${slug}.json`), JSON.stringify({ icons, aliases }));

    console.log(
      `[icons] ${slug}: ${collection.total} icons, ${collection.aliases} aliases` +
        (info ? ` · ${info.name} · ${info.license?.spdx ?? info.license?.title ?? "?"}` : ""),
    );
  }

  // Manifest is only the metadata + alias maps (searchable, no bodies).
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[icons] manifest written to ${OUT}/manifest.json`);

  // Quick size summary.
  let bodiesBytes = 0;
  for (const slug of Object.keys(COLLECTIONS)) {
    bodiesBytes += statSize(join(OUT, "icons", `${slug}.json`));
  }
  console.log(`[icons] total icon-body assets: ${(bodiesBytes / 1024).toFixed(0)} KB`);
}

function statSize(p) {
  try {
    return readFileSync(p).byteLength;
  } catch {
    return 0;
  }
}

main();
