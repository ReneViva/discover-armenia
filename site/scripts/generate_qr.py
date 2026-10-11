"""Generate and independently decode the final Discover Armenia QR deliverables.

Run only after deployment and public URL verification:
    python site/scripts/generate_qr.py "YOUR_VERIFIED_PUBLIC_HTTPS_URL"

Dependencies: pip install qrcode pillow zxing-cpp
The default output directory is <project root>/deliverables/.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html import escape
import io
import ipaddress
import json
from pathlib import Path
from urllib.parse import urlsplit

import qrcode
from qrcode.image.svg import SvgPathFillImage
import zxingcpp


def validate_public_https_url(value: str) -> str:
    """Check URL shape without rewriting the exact encoded address."""
    if value != value.strip() or any(ord(c) < 32 for c in value):
        raise ValueError("Supply the exact URL without whitespace or control characters.")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("The deployed URL must be an absolute public HTTPS address.")
    if parsed.username or parsed.password:
        raise ValueError("A public QR URL must not contain login credentials.")
    try:
        parsed.port
    except ValueError as error:
        raise ValueError("The URL contains an invalid port.") from error
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(
        (".localhost", ".local", ".test", ".invalid", ".example")
    ):
        raise ValueError("Local, reserved, and example hosts cannot be final QR targets.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("Private or loopback IP addresses cannot be final QR targets.")
    return value


def poster_html(url: str, png_name: str) -> str:
    safe_url = escape(url, quote=True)
    safe_png = escape(png_name, quote=True)
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scan to Discover Armenia — Printable QR Poster</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      background: #e9e5df; color: #152947;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .poster {
      position: relative; width: 210mm; min-height: 297mm;
      margin: 24px auto; padding: 17mm 17mm 15mm;
      background: #fffaf1; text-align: center; overflow: hidden;
      box-shadow: 0 12px 45px #15294725;
    }
    .top-line { position: absolute; inset: 0 0 auto; height: 7mm;
      background: linear-gradient(to right, #d32632 0 33.333%, #173b80 33.333% 66.666%, #f28c28 66.666% 100%); }
    .flag { width: 49mm; height: 25mm; margin: 0 auto 7mm; border-radius: 2mm;
      background: linear-gradient(to bottom, #d32632 0 33.333%, #173b80 33.333% 66.666%, #f28c28 66.666% 100%);
      box-shadow: 0 4px 15px #15294715; }
    .event { font-size: 11px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; }
    h1 { margin: 4mm auto 3mm; max-width: 165mm; font-size: 41px; line-height: 1.12; letter-spacing: -1px; }
    .subtitle { margin: 0 0 8mm; font-size: 18px; font-weight: 500; }
    .qr-frame { width: 110mm; height: 110mm; padding: 3mm; margin: 0 auto;
      background: white; border: 1px solid #d5dbe4; border-radius: 5mm;
      box-shadow: 0 6px 26px #1529470f; }
    .qr-frame img { width: 100%; height: 100%; display: block; image-rendering: crisp-edges; }
    .instructions { margin: 6mm 0 3mm; font-size: 16px; font-weight: 650; }
    .url { display: block; margin: 0 auto; max-width: 165mm; color: #173b80;
      font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; text-decoration: none; }
    .experiences { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin: 7mm 0 5mm; }
    .experiences span { background: #152947; color: white; padding: 8px 12px;
      border-radius: 99px; font-size: 12px; font-weight: 600; }
    .footer { margin: 0; font-size: 13px; line-height: 1.7; color: #475670; }
    .bottom-line { height: 1.4mm; margin: 7mm 15mm 0; background: #f28c28; border-radius: 99px; }
    .print-button { display: block; margin: 18px auto 0; border: 0; border-radius: 10px;
      padding: 12px 18px; background: #152947; color: white; cursor: pointer; font: inherit; }
    @media screen and (max-width: 850px) {
      .poster { width: calc(100% - 28px); min-height: auto; padding: 54px 20px 30px; margin: 14px auto; }
      h1 { font-size: clamp(28px, 6vw, 41px); }
      .qr-frame { width: min(100%, 110mm); height: auto; aspect-ratio: 1; }
    }
    @media print {
      body { background: white; }
      .poster { margin: 0; box-shadow: none; }
      .print-button { display: none; }
    }
  </style>
</head>
<body>
  <main class="poster">
    <div class="top-line" aria-hidden="true"></div>
    <div class="flag" role="img" aria-label="Armenian flag: red, blue and orange horizontal bands"></div>
    <div class="event">Armenian Cultural Night · Finland 2026</div>
    <h1>SCAN TO DISCOVER<br>ARMENIA 🇦🇲</h1>
    <p class="subtitle">One Country. Thousands of Stories.</p>
    <div class="qr-frame"><img src="__PNG__" alt="QR code linking to the Discover Armenia website"></div>
    <p class="instructions">Open your phone camera, scan, and explore.</p>
    <a class="url" href="__URL__">__URL__</a>
    <div class="experiences" aria-label="Five cultural experiences">
      <span>Dance</span><span>Food</span><span>History</span><span>Music</span><span>The Armenian Challenge</span>
    </div>
    <p class="footer">Discover Armenia<br>Rural Youth Europe Autumn Seminar 2026</p>
    <div class="bottom-line" aria-hidden="true"></div>
    <button class="print-button" type="button" onclick="window.print()">Print A4 poster</button>
  </main>
</body>
</html>
""".replace("__URL__", safe_url).replace("__PNG__", safe_png)


def generate(url: str, output_directory: Path) -> dict:
    url = validate_public_https_url(url)
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=40,
        border=6,
    )
    qr.add_data(url, optimize=0)
    qr.make(fit=True)
    pil_image = qr.make_image(fill_color="black", back_color="white").get_image().convert("RGB")
    result = zxingcpp.read_barcode(pil_image)
    if result is None or result.text != url:
        actual = result.text if result else "No QR code detected"
        raise RuntimeError(f"Independent QR decoding failed: {actual!r}")

    png_buffer = io.BytesIO()
    pil_image.save(png_buffer, format="PNG", dpi=(300, 300))
    svg_buffer = io.BytesIO()
    qr.make_image(image_factory=SvgPathFillImage).save(svg_buffer)

    output_directory.mkdir(parents=True, exist_ok=True)
    png_path = output_directory / "ARMENIA_QR.png"
    svg_path = output_directory / "ARMENIA_QR.svg"
    poster_path = output_directory / "ARMENIA_QR_PRINT.html"
    png_path.write_bytes(png_buffer.getvalue())
    svg_path.write_bytes(svg_buffer.getvalue())
    poster_path.write_text(poster_html(url, png_path.name), encoding="utf-8")

    # Check the saved PNG, not just the in-memory image.
    from PIL import Image

    with Image.open(png_path) as saved_image:
        saved_result = zxingcpp.read_barcode(saved_image)
    if saved_result is None or saved_result.text != url:
        raise RuntimeError("The saved PNG did not decode to the exact input URL.")

    verification = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "targetUrl": url,
        "decodedUrl": saved_result.text,
        "exactMatch": saved_result.text == url,
        "decoder": "zxing-cpp",
        "format": "QR Code",
        "pixelDimensions": list(pil_image.size),
        "quietZoneModules": 6,
        "errorCorrection": "M",
        "png": str(png_path.resolve()),
        "svg": str(svg_path.resolve()),
        "printPoster": str(poster_path.resolve()),
        "note": "URL supplied after deployment verification; QR decoding checks the exact encoded address.",
    }
    verification_path = output_directory / "QR_VERIFICATION.json"
    verification_path.write_text(json.dumps(verification, indent=2) + "\n", encoding="utf-8")
    return verification


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Exact verified public HTTPS deployment URL")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "deliverables",
        help="Output folder (default: project-root/deliverables)",
    )
    args = parser.parse_args()
    try:
        verification = generate(args.url, args.output_dir)
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"QR generation failed: {error}\n")
    print(json.dumps(verification, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
