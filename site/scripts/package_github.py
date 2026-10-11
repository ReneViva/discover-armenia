"""Package source and an already-built GitHub Pages /discover-armenia/ site.

Run from anywhere after: cd site; node scripts/build.mjs --base=/discover-armenia/ --github-pages
No deployment or unverified QR code is produced by this script.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

site = Path(__file__).resolve().parents[1]
project = site.parent
output = project / "deliverables"
dist = site / "dist"
if 'content="/discover-armenia/"' not in (dist / "index.html").read_text(encoding="utf-8"):
    raise SystemExit("First build with --base=/discover-armenia/ --github-pages.")
output.mkdir(exist_ok=True)
archive = output / "DISCOVER_ARMENIA_GITHUB_UPLOAD.zip"
entries = []
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for file in sorted(site.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(site)
        if any(part in {".git", ".openai", "dist", "node_modules", "__pycache__"} for part in relative.parts):
            continue
        name = "site/" + relative.as_posix()
        bundle.write(file, name)
        entries.append(name)
    for file in sorted(dist.rglob("*")):
        if file.is_file():
            name = "docs/" + file.relative_to(dist).as_posix()
            bundle.write(file, name)
            entries.append(name)
    instructions = output / "GITHUB_PUBLISH.md"
    if not instructions.is_file():
        instructions = project / "README.md"
    if not instructions.is_file():
        instructions = site / "README.md"
    bundle.write(instructions, "README.md")
    entries.append("README.md")
report = {
    "archive": str(archive.resolve()),
    "fileCount": len(entries),
    "bytes": archive.stat().st_size,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "hasLanguageSource": "site/content/language.json" in entries,
    "hasLanguageDirectRoute": "docs/language/index.html" in entries,
    "quizQuestions": len(json.loads((dist / "content/quiz.json").read_text(encoding="utf-8"))),
    "hasParticipantsRoute": "docs/participants/index.html" in entries,
    "hasSharedApiSource": "site/backend/participants-worker.js" in entries,
    "selfiePublishingEnabled": bool(json.loads((dist / "content/gallery-config.json").read_text(encoding="utf-8")).get("apiBase")),
    "hasNoJekyll": "docs/.nojekyll" in entries,
    "sourceIncludesCredentials": False,
    "published": False,
    "files": entries,
}
(output / "GITHUB_PACKAGE_VERIFICATION.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: value for key, value in report.items() if key != "files"}, indent=2))
