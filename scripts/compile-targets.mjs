import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "canvas";
import { OfflineCompiler } from "mind-ar/src/image-target/offline-compiler.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const markerDir = path.join(appDir, "marker-sources");
const manifestPath = path.join(appDir, "public", "data", "marker_manifest.json");
const outputDir = path.join(appDir, "public", "assets");
const outputPath = path.join(outputDir, "targets.mind");
const metadataPath = path.join(outputDir, "targets.metadata.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const ordered = [...manifest.markers].sort((a, b) => a.targetIndex - b.targetIndex);

if (ordered.length !== 6 || ordered.some((item, index) => item.targetIndex !== index)) {
  throw new Error("marker_manifest.json의 targetIndex가 0~5 연속 순서가 아닙니다.");
}

const images = [];
const sources = [];

for (const item of ordered) {
  const sourcePath = path.join(markerDir, item.file);
  const source = await readFile(sourcePath);
  const image = await loadImage(source);
  const [expectedWidth, expectedHeight] = item.dimensions;
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    throw new Error(`${item.file} 규격 불일치: ${image.width}×${image.height}`);
  }
  images.push(image);
  sources.push({
    targetIndex: item.targetIndex,
    file: item.file,
    width: image.width,
    height: image.height,
    sha256: createHash("sha256").update(source).digest("hex"),
  });
}

console.log("MindAR target compile order:");
for (const item of sources) console.log(`  ${item.targetIndex}: ${item.file}`);

const compiler = new OfflineCompiler();
let lastProgress = -10;
await compiler.compileImageTargets(images, (progress) => {
  const rounded = Math.floor(progress / 10) * 10;
  if (rounded > lastProgress) {
    lastProgress = rounded;
    console.log(`  progress ${Math.min(100, rounded)}%`);
  }
});

const buffer = compiler.exportData();
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, buffer);
await writeFile(
  metadataPath,
  JSON.stringify(
    {
      schema_version: manifest.schema_version,
      compiler: "mind-ar@1.2.5 OfflineCompiler",
      generated_at: new Date().toISOString(),
      target_count: sources.length,
      output_bytes: buffer.byteLength,
      sources,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Created ${path.relative(appDir, outputPath)} (${buffer.byteLength} bytes)`);
