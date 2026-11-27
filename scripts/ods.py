#!/usr/bin/env python3
"""ONLYTOOLS Standard utilities; Python standard library only."""
import argparse, datetime, hashlib, json, re, sys
from pathlib import Path

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$")
PH = re.compile(r"\{\{[^}]+\}\}")

def read_json(path):
    try: return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e: raise ValueError(f"Cannot read JSON {path}: {e}")

def config(path):
    c=read_json(path); errors=[]
    if c.get("schemaVersion") != 2: errors.append("schemaVersion must equal 2")
    p=c.get("product",{}); r=c.get("repository",{}); rel=c.get("release",{}); b=c.get("build",{})
    for k in ("name","slug","tagline","category","status"):
        if not p.get(k): errors.append(f"product.{k} is required")
    if p.get("slug") and not re.fullmatch(r"[a-z0-9-]+",p["slug"]): errors.append("product.slug must be lowercase slug")
    if r.get("owner") != "onlytools-lab": errors.append("repository.owner must be onlytools-lab")
    for k in ("name","url"):
        if not r.get(k): errors.append(f"repository.{k} is required")
    if rel.get("tagPrefix") != "v": errors.append("release.tagPrefix must be v")
    if not isinstance(rel.get("requireSha256"),bool): errors.append("release.requireSha256 must be boolean")
    if not isinstance(b.get("commands"),dict): errors.append("build.commands must be an object")
    if errors:
        print("\\n".join("ERROR: "+e for e in errors)); return 1
    print(f"Config structure OK: {p['name']} ({p['slug']})")
    if "TODO" in json.dumps(c): print("WARNING: TODO values remain; verify before release.")
    return 0

def readme(path):
    p=Path(path)
    if not p.exists(): print("ERROR: README missing"); return 1
    body=p.read_text(encoding="utf-8")
    required=["# ","## 功能特性","## 系统要求","## 下载与安装","## 快速开始","## 数据与隐私","## 问题反馈","## 许可证"]
    missing=[x for x in required if x not in body]
    placeholders=PH.findall(body)
    if missing or placeholders:
        if missing: print("ERROR: missing headings: "+", ".join(missing))
        if placeholders: print("ERROR: unresolved placeholders: "+", ".join(placeholders))
        return 1
    print("README structure OK; factual accuracy still requires review.")
    return 0

def release(notes,version,config_path="onlytools.config.json"):
    errors=[]
    if not SEMVER.fullmatch(version): errors.append("invalid SemVer version")
    c=read_json(config_path); product=c.get("product",{}).get("name","")
    p=Path(notes)
    if not p.exists(): errors.append("Release Notes file missing")
    else:
        body=p.read_text(encoding="utf-8")
        for h in ("## Highlights","## Compatibility","## Downloads","## Verification"):
            if h not in body: errors.append("missing heading "+h)
        if PH.findall(body): errors.append("unresolved template placeholders")
        if "TODO" in body or "待补充" in body: errors.append("TODO remains")
        # 标题必须精确为「# 产品名 vX.Y.Z」（防旧文件改名复用）
        first = body.split("\n",1)[0].strip()
        expected = f"# {product} v{version}"
        if first != expected: errors.append(f"title must be '{expected}' (actual: '{first}')")
        # Downloads 中的资产名必须带当前版本（防复制旧版资产清单）
        m = re.search(r"(?ms)^## Downloads\s*(.*?)(?=^## |\Z)", body)
        if m:
            assets = re.findall(r"`([^`]+\.(?:exe|msi|html|txt))`", m.group(1))
            if not assets: errors.append("Downloads section lists no assets")
            for a in assets:
                if a == "SHA256SUMS.txt": continue
                if f"v{version}" not in a: errors.append(f"asset name '{a}' does not contain v{version}")
                if not a.startswith(f"{product}-"): errors.append(f"asset name '{a}' not in {{product}}-… standard form")
    if errors:
        print("\n".join("ERROR: "+e for e in errors)); return 1
    print(f"Release Notes structure OK for v{version}")
    return 0

def version_check(version, pkg_path="package.json", tauri_path="src-tauri/tauri.conf.json"):
    """三方版本一致性：传入版本 ↔ package.json ↔ tauri.conf.json"""
    errors=[]
    if not SEMVER.fullmatch(version): errors.append("invalid SemVer version")
    pkg=read_json(pkg_path)
    if pkg.get("version")!=version: errors.append(f"package.json version {pkg.get('version')} != {version}")
    tauri=read_json(tauri_path)
    tv=tauri.get("version") or tauri.get("package",{}).get("version")
    if tv!=version: errors.append(f"tauri.conf.json version {tv} != {version}")
    if errors:
        print("\n".join("ERROR: "+e for e in errors)); return 1
    print(f"Version consistency OK: {version} (tag/package.json/tauri.conf.json)")
    return 0

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CATEGORIES = ("Added", "Changed", "Deprecated", "Removed", "Fixed", "Security")

def changelog_check(path, version, config_path="onlytools.config.json", structure_only=False):
    """CHANGELOG 校验：
    structure_only（PR 用）：只看结构（有 Unreleased、章节格式良好、无占位符）
    完整模式（发布用）：目标版本章节存在 + 真实日历日期 + 至少一个分类有实际条目 +
    精确链接定义 [x.y.z]: <repo>/releases/tag/vx.y.z + [Unreleased] 比较链接指向当前版本
    """
    errors=[]
    p=Path(path)
    if not p.exists(): print("ERROR: CHANGELOG missing"); return 1
    body=p.read_text(encoding="utf-8")
    c=read_json(config_path); repo=c.get("repository",{}).get("url","").rstrip("/")

    if not re.search(r"(?m)^## \[Unreleased\]", body): errors.append("missing [Unreleased] section")
    if PH.findall(body): errors.append("unresolved template placeholders")
    bad = re.findall(r"(?m)^## \[(?!Unreleased\])([^\]]+)\](?: - (\S+))?", body)
    for name, date in bad:
        if not SEMVER.fullmatch(name): errors.append(f"malformed version heading [{name}]")
        if date and not DATE_RE.fullmatch(date):
            errors.append(f"[{name}] date '{date}' not YYYY-MM-DD")
        elif date:
            try: datetime.date.fromisoformat(date)
            except ValueError: errors.append(f"[{name}] date '{date}' is not a real calendar date")

    if not structure_only:
        m=re.search(rf"(?ms)^## \[{re.escape(version)}\](?: - (\S+))?\s*(.*?)(?=^## \[|\Z)",body)
        if not m:
            errors.append(f"CHANGELOG section [{version}] not found")
        else:
            date, content = m.group(1), m.group(2)
            if not date or not DATE_RE.fullmatch(date):
                errors.append(f"[{version}] section has no valid date (YYYY-MM-DD)")
            else:
                try: datetime.date.fromisoformat(date)
                except ValueError: errors.append(f"[{version}] date '{date}' is not a real calendar date")
            # 分类下必须有实际条目（### 行后至少一条 - 列表项）
            has_entry = False
            for cat in CATEGORIES:
                cm = re.search(rf"(?ms)^### {cat}\s*\n((?:^[ \t]*[-*].*\n?)+)", content)
                if cm: has_entry = True
            if not has_entry: errors.append(f"[{version}] section has no non-empty categorized entries")
        if repo:
            # 精确匹配链接定义行（防止只在正文出现字符串蒙混）
            if not re.search(rf"(?m)^\[{re.escape(version)}\]: {re.escape(repo)}/releases/tag/v{re.escape(version)}$", body):
                errors.append(f"link definition [{version}]: {repo}/releases/tag/v{version} missing")
            if not re.search(rf"(?m)^\[Unreleased\]: {re.escape(repo)}/compare/v{re.escape(version)}\.\.\.HEAD$", body):
                errors.append(f"link definition [Unreleased]: {repo}/compare/v{version}...HEAD missing")
    if errors:
        print("\n".join("ERROR: "+e for e in errors)); return 1
    print(f"CHANGELOG OK" + ("" if structure_only else f" for v{version}"))
    return 0

def hashes(paths):
    failed=False
    for item in paths:
        p=Path(item)
        if not p.is_file(): print("ERROR: missing file "+str(p)); failed=True; continue
        h=hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
        print(f"{h.hexdigest()}  {p}")
    return int(failed)

def draft(cfgpath,changelog,version,out):
    c=read_json(cfgpath); name=c.get("product",{}).get("name","TODO")
    text=Path(changelog).read_text(encoding="utf-8")
    m=re.search(rf"(?ms)^## \[{re.escape(version)}\](?: - .*?)?\s*(.*?)(?=^## \[|\Z)",text)
    if not m: print(f"ERROR: CHANGELOG section [{version}] not found"); return 1
    body=f"""# {name} v{version}

## Highlights
TODO: Summarize user value from verified changes.

{m.group(1).strip()}

## Compatibility
- Windows: TODO
- Architecture: TODO
- Runtime: TODO
- Breaking changes / migration: TODO

## Known Issues
TODO: Record verified issues or state none within the tested scope.

## Downloads
TODO: Add actual assets and SHA-256.

## Verification
- Build: TODO
- Tests: TODO
- Package smoke test: TODO
"""
    Path(out).write_text(body,encoding="utf-8")
    print(f"Draft created: {out}. Complete all TODOs before release.")
    return 0

def main():
    p=argparse.ArgumentParser(prog="ods"); s=p.add_subparsers(dest="cmd",required=True)
    x=s.add_parser("validate-config"); x.add_argument("--config",required=True)
    x=s.add_parser("validate-readme"); x.add_argument("--readme",default="README.md")
    x=s.add_parser("validate-release"); x.add_argument("--notes",required=True); x.add_argument("--version",required=True)
    x=s.add_parser("validate-version"); x.add_argument("--version",required=True)
    x=s.add_parser("validate-changelog"); x.add_argument("--changelog",default="CHANGELOG.md"); x.add_argument("--version",default=""); x.add_argument("--structure-only",action="store_true")
    x=s.add_parser("hash-artifacts"); x.add_argument("artifacts",nargs="+")
    x=s.add_parser("release-notes"); x.add_argument("--config",default="onlytools.config.json"); x.add_argument("--changelog",default="CHANGELOG.md"); x.add_argument("--version",required=True); x.add_argument("--output",default="RELEASE_NOTES.md")
    a=p.parse_args()
    try:
        if a.cmd=="validate-config": return config(a.config)
        if a.cmd=="validate-readme": return readme(a.readme)
        if a.cmd=="validate-release": return release(a.notes,a.version)
        if a.cmd=="validate-version": return version_check(a.version)
        if a.cmd=="validate-changelog": return changelog_check(a.changelog,a.version,structure_only=a.structure_only)
        if a.cmd=="hash-artifacts": return hashes(a.artifacts)
        if a.cmd=="release-notes": return draft(a.config,a.changelog,a.version,a.output)
    except Exception as e: print("ERROR:",e); return 1
    return 2
if __name__=="__main__": sys.exit(main())
