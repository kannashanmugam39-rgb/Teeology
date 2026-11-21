#!/usr/bin/env python3
"""Bundle src/ into a single self-contained dist/index.html."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / "src"
css = (src / "app.css").read_text()
engine = (src / "engine.js").read_text()
app = (src / "app.js").read_text()
html = f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1F4D3A">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Teeology</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>
<script>
{engine}
</script>
<script>
{app}
</script>
</body>
</html>
"""
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "index.html").write_text(html)
print("dist/index.html", len(html), "bytes")
