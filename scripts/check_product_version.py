#!/usr/bin/env python3
"""Cross-product version check. Supports JSON and MSBuild XML without third-party packages."""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

def check(version, files):
    if not files:
        raise ValueError("No version files configured")
    for name in files:
        p = Path(name)
        if p.is_absolute() or ".." in p.parts or not p.is_file():
            raise ValueError(f"Invalid or missing version file: {name}")
        if p.suffix == ".json":
            obj = json.loads(p.read_text(encoding="utf-8"))
            actual = obj.get("version") or obj.get("package", {}).get("version")
        elif p.suffix in (".csproj", ".props"):
            root = ET.parse(p).getroot()
            actual = root.findtext(".//Version") or root.findtext(".//VersionPrefix")
        else:
            raise ValueError(f"Unsupported version source: {name}")
        if actual != version:
            raise ValueError(f"{name}: expected {version}, got {actual}")
    return True

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--version", required=True)
    p.add_argument("--config", default="onlytools.config.json")
    args = p.parse_args()
    try:
        cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
        files = cfg.get("build", {}).get("versionFiles")
        if files is None:
            files = ["package.json", "src-tauri/tauri.conf.json"]
        check(args.version, files)
    except (OSError, ValueError, ET.ParseError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(f"Version sources agree: {args.version}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
