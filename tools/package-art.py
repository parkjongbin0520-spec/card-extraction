"""Package already-built, original Cardkov art for offline review; no dependencies."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
files = sorted((root / "assets/pixel").rglob("*.png"))
files += [root / "assets/pixel/palette.json"]
files += sorted((root / "assets/ui").glob("*"))
files += [root / p for p in (
    "assets/art-manifest.json", "docs/asset-pack.md", "assets.html",
    "asset-theme.css", "art.js",
)]
target = root / "assets/cardkov-art-pack.zip"
with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(root))
print(f"Packaged {len(files)} files: {target.stat().st_size:,} bytes")
