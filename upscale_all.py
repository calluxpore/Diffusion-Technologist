"""
Portable Antigravity `run_workflow` script to upscale and restore all model
poster WebPs referenced in `models.json`.

Usage on another computer (Windows, macOS, or Linux):
1. Pull the latest repository (including updated `media/*.webp` and
   `upscale_state.json`) and open it in Antigravity with `ffmpeg` and
   `ffprobe` installed (on `PATH`, in standard system/package-manager
   directories, or supplied via `Args` / env vars).
2. Ask Antigravity to execute `upscale_all.py` using `run_workflow`.
   Completed models are tracked in `upscale_state.json` (verified by status
   and exact byte size), so re-running automatically resumes from where the
   previous run stopped. Transient `quota_blocked` entries are NOT persisted
   to `upscale_state.json`. Temporary backups and extracted source PNGs are
   kept in `.upscale_cache/` (gitignored).
3. Before switching computers, commit and push updated `media/*.webp` and
   `upscale_state.json` so the next machine picks up where you left off.

Optional `Args` dictionary passed via `run_workflow`:
- `batch_size` (int, default 4): Number of models to upscale concurrently per batch.
- `probe_first` (bool, default True): Run 1 model alone before full batches so
  quota exhaustion fails fast without wasting calls.
- `max_retries` (int, default 2): Retries per model for non-quota failures.
- `only` (list[str], default []): Optional list of model slugs to process.
- `skip_slugs` (list[str], default []): Optional list of slugs to skip.
- `dry_run` (bool, default False): Log resolved paths, binary availability, and
  queued models without modifying files or invoking agents.
- `ffmpeg_dir` (str, optional): Directory containing `ffmpeg` and `ffprobe`
  binaries when not on `PATH` or in common install locations.
- `ffmpeg_path` (str, optional): Explicit path to the `ffmpeg` binary (also
  supports env var `FFMPEG_BIN`).
- `ffprobe_path` (str, optional): Explicit path to the `ffprobe` binary (also
  supports env var `FFPROBE_BIN`).
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import unquote, urlparse


def resolve_repo_dir() -> Path:
    ws = globals().get("WORKSPACES")
    if ws:
        cand = Path(ws[0]).resolve()
        if (cand / "models.json").exists():
            return cand
    if "__file__" in globals():
        cand = Path(__file__).resolve().parent
        if (cand / "models.json").exists():
            return cand
    return Path.cwd().resolve()


REPO_DIR = resolve_repo_dir()
MODELS_JSON = REPO_DIR / "models.json"
MEDIA_DIR = REPO_DIR / "media"

CACHE_DIR = REPO_DIR / ".upscale_cache"
BACKUP_DIR = CACHE_DIR / "backup_webp"
SRC_PNG_DIR = CACHE_DIR / "src_png"
TMP_WEBP_DIR = CACHE_DIR / "tmp_webp"
STATE_FILE = REPO_DIR / "upscale_state.json"

FFMPEG_BIN = "ffmpeg"
FFPROBE_BIN = "ffprobe"


def resolve_binary(
    name: str,
    explicit: Optional[str] = None,
    bin_dir: Optional[str] = None,
) -> Optional[str]:
    exe_names = [f"{name}.exe", name] if os.name == "nt" else [name]

    candidate_raw = explicit or os.environ.get(f"{name.upper()}_BIN")
    if candidate_raw:
        cand = Path(candidate_raw).expanduser()
        if cand.is_file():
            return str(cand.resolve())
        found = shutil.which(candidate_raw)
        if found:
            return found

    if bin_dir:
        bdir = Path(bin_dir).expanduser()
        for exe in exe_names:
            cand = bdir / exe
            if cand.is_file():
                return str(cand.resolve())

    found = shutil.which(name)
    if found:
        return found

    fallback_dirs: List[Path] = []
    if os.name == "nt":
        local_app = os.environ.get("LOCALAPPDATA")
        user_prof = os.environ.get("USERPROFILE")
        if local_app:
            la = Path(local_app)
            fallback_dirs.append(la / "Microsoft" / "WinGet" / "Links")
            wg_pkgs = la / "Microsoft" / "WinGet" / "Packages"
            if wg_pkgs.is_dir():
                fallback_dirs.extend(sorted(wg_pkgs.glob("Gyan.FFmpeg*/*/bin"), reverse=True))
                fallback_dirs.extend(sorted(wg_pkgs.glob("Gyan.FFmpeg*/bin"), reverse=True))
        if user_prof:
            fallback_dirs.append(Path(user_prof) / "scoop" / "shims")
        fallback_dirs.extend([
            Path(r"C:\ProgramData\chocolatey\bin"),
            Path(r"C:\ffmpeg\bin"),
        ])
    else:
        fallback_dirs.extend([
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            Path("/opt/local/bin"),
            Path("/usr/bin"),
            Path.home() / ".local" / "bin",
        ])

    for d in fallback_dirs:
        for exe in exe_names:
            cand = d / exe
            if cand.is_file():
                return str(cand.resolve())

    return None


def run_cmd(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


async def arun_cmd(cmd: List[str]) -> subprocess.CompletedProcess:
    return await asyncio.get_running_loop().run_in_executor(None, run_cmd, cmd)


async def probe_dims(path: Path) -> Tuple[int, int]:
    proc = await arun_cmd([
        FFPROBE_BIN, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)
    ])
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {proc.stderr.strip()}")
    line = proc.stdout.strip().splitlines()[0]
    w_s, h_s = line.split("x")
    return int(w_s), int(h_s)


async def measure_blur(path: Path) -> Optional[float]:
    proc = await arun_cmd([
        FFMPEG_BIN, "-v", "error", "-i", str(path),
        "-vf", "blurdetect,metadata=print:file=-", "-f", "null", "-"
    ])
    m = re.search(r"lavfi\.blur=([0-9.]+)", proc.stdout + "\n" + proc.stderr)
    return float(m.group(1)) if m else None


async def compute_ssim_vs_mp4(webp_path: Path, mp4_path: Path, t: float) -> float:
    proc = await arun_cmd([
        FFMPEG_BIN, "-v", "info", "-i", str(webp_path), "-ss", str(t), "-i", str(mp4_path),
        "-filter_complex", "[0:v][1:v]scale2ref[w][f];[w][f]ssim",
        "-frames:v", "1", "-f", "null", "-"
    ])
    m = re.search(r"All:([0-9.]+)", proc.stderr)
    return float(m.group(1)) if m else -1.0


async def compute_ssim_images(img_a: Path, img_b: Path) -> float:
    proc = await arun_cmd([
        FFMPEG_BIN, "-v", "info", "-i", str(img_a), "-i", str(img_b),
        "-filter_complex", "[0:v][1:v]scale2ref[w][f];[w][f]ssim",
        "-frames:v", "1", "-f", "null", "-"
    ])
    m = re.search(r"All:([0-9.]+)", proc.stderr)
    return float(m.group(1)) if m else -1.0


def pick_aspect_ratio(w: int, h: int) -> str:
    ratio = w / h
    if 0.95 <= ratio <= 1.05:
        return "1:1"
    if ratio < 0.62:
        return "9:16"
    if ratio < 0.77:
        return "3:4"
    if ratio < 0.95:
        return "4:5"
    if ratio > 1.50:
        return "16:9"
    return "4:3"


def normalize_saved_path(raw: str) -> Path:
    s = raw.strip().strip("`\"'<>")
    md_match = re.search(r"\((file://[^)\s]+)\)", s)
    if md_match:
        s = md_match.group(1)
    if s.startswith("file://"):
        parsed = urlparse(s)
        p = unquote(parsed.path)
        if parsed.netloc and parsed.netloc.lower() not in ("", "localhost"):
            p = f"//{parsed.netloc}{p}"
        elif len(p) >= 3 and p[0] == "/" and p[2] == ":" and p[1].isalpha():
            p = p[1:]
        s = p
    return Path(s).expanduser()


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    clean_state = {
        k: v for k, v in state.items()
        if isinstance(v, dict) and v.get("status") != "quota_blocked"
    }
    tmp = STATE_FILE.with_suffix(".json.tmp")
    payload = json.dumps(clean_state, indent=2, ensure_ascii=False) + "\n"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(payload)
    try:
        os.replace(tmp, STATE_FILE)
    except OSError:
        shutil.copy2(tmp, STATE_FILE)
        tmp.unlink(missing_ok=True)


def clean_slug_id(slug: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", slug).strip("_").lower() or "model"


def is_quota_error(text: str) -> bool:
    lower = (text or "").lower()
    return any(
        token in lower
        for token in ("429", "resource_exhausted", "quota_exhausted", "too many requests", "quota")
    )


async def process_one(model: dict, max_retries: int) -> dict:
    slug = model["slug"]
    name = model.get("name", slug)
    media_webp = MEDIA_DIR / f"{slug}.webp"
    media_mp4 = MEDIA_DIR / f"{slug}.mp4"
    backup_webp = BACKUP_DIR / f"{slug}.webp"
    src_png = SRC_PNG_DIR / f"{slug}.png"
    tmp_webp = TMP_WEBP_DIR / f"{slug}.webp"

    try:
        if not media_webp.exists():
            raise FileNotFoundError(f"Missing poster: {media_webp}")
        if not media_mp4.exists():
            raise FileNotFoundError(f"Missing video: {media_mp4}")

        # 1. Backup original once and probe original stats
        if not backup_webp.exists():
            shutil.copy2(media_webp, backup_webp)

        old_w, old_h = await probe_dims(backup_webp)
        old_bytes = backup_webp.stat().st_size
        old_blur = await measure_blur(backup_webp)
        mp4_w, mp4_h = await probe_dims(media_mp4)

        # 2. Extract best lossless source PNG
        best_ssim, best_t = -1.0, 0.0
        for t in (0.0, 0.5, 1.0):
            s = await compute_ssim_vs_mp4(backup_webp, media_mp4, t)
            if s > best_ssim:
                best_ssim, best_t = s, t

        if best_ssim >= 0.85 and (old_w < mp4_w or old_bytes < 30000):
            used_source = f"mp4@{best_t}s(ssim={best_ssim:.3f})"
            proc = await arun_cmd([
                FFMPEG_BIN, "-y", "-ss", str(best_t), "-i", str(media_mp4),
                "-vframes", "1", str(src_png)
            ])
        else:
            used_source = f"webp(mp4_ssim={best_ssim:.3f})"
            proc = await arun_cmd([
                FFMPEG_BIN, "-y", "-i", str(backup_webp), str(src_png)
            ])
        if proc.returncode != 0 or not src_png.exists():
            raise RuntimeError(f"Source PNG extraction failed: {proc.stderr.strip()}")

        src_w, src_h = await probe_dims(src_png)

        # 3. Pick target aspect ratio
        aspect_ratio = pick_aspect_ratio(src_w, src_h)
        aspect_note = (
            f"Use AspectRatio '{aspect_ratio}' (if '4:5' is not accepted by your tool, use '3:4')."
            if aspect_ratio == "4:5"
            else f"Use AspectRatio '{aspect_ratio}'."
        )
        img_name_base = f"upscale_{clean_slug_id(slug)}"

        # 4. Invoke image-generator with up to max_retries attempts
        last_err = None
        schema = {
            "type": "object",
            "properties": {
                "saved_path": {"type": "string"},
                "notes": {"type": "string"}
            },
            "required": ["saved_path"]
        }

        for attempt in range(1, max_retries + 1):
            try:
                img_name = img_name_base if attempt == 1 else f"{img_name_base}_r{attempt}"
                retry_note = (
                    ""
                    if attempt == 1
                    else f"\nCRITICAL RETRY NOTE: Previous attempt had issue ({last_err}). Match the exact composition, framing, colors, subjects, and orientation of the input image."
                )
                prompt = (
                    f"Perform a high-resolution super-resolution upscale and deblurring restoration of the exact image at:\n"
                    f"{src_png}\n\n"
                    f"Tool parameters: {aspect_note} Set ImageName to '{img_name}'. Pass {json.dumps([str(src_png)])} in ImagePaths.\n\n"
                    f"Strict fidelity constraints:\n"
                    f"- Preserve the EXACT composition, framing, crop, perspective, aspect ratio, subjects, any text/typography verbatim, proportions, poses, expressions, colors, lighting, background, and art style/medium.\n"
                    f"- Do NOT recompose, zoom in/out, crop differently, alter text, change facial identity, or add/remove any elements.\n\n"
                    f"Quality target:\n"
                    f"- Completely eliminate compression blur, blockiness, JPEG/WebP/H.264 artifacts, noise, and softness.\n"
                    f"- Restore crisp edges, fine textures, brushwork, linework, halftone dots, typography clarity, hair/fur/fabric/surface detail.\n"
                    f"{retry_note}\n"
                    f"When done, call `finish` with `{{\"saved_path\": \"<exact absolute path to generated image>\", \"notes\": \"brief summary\"}}`."
                )

                res = await agent(
                    prompt=prompt,
                    schema=schema,
                    role=f"Upscale {slug}" + (f" (retry {attempt})" if attempt > 1 else ""),
                    type_name="image-generator"
                )

                raw_path = (res.get("saved_path") or "").strip()
                notes = (res.get("notes") or "").strip()
                if is_quota_error(notes) or is_quota_error(raw_path):
                    msg = notes or raw_path
                    log(f"[QUOTA] {slug}: {msg}")
                    return {
                        "slug": slug,
                        "name": name,
                        "status": "quota_blocked",
                        "error": msg
                    }
                if not raw_path or raw_path in (".", "./", ".\\", "\\"):
                    raise ValueError(f"Empty/invalid saved_path from agent (notes: {notes})")

                saved_path = normalize_saved_path(raw_path)
                if not saved_path.exists():
                    raise FileNotFoundError(f"Generated image not found: {saved_path}")

                gen_w, gen_h = await probe_dims(saved_path)
                if src_w != src_h and (gen_w > gen_h) != (src_w > src_h):
                    raise ValueError(f"Orientation mismatch: src={src_w}x{src_h}, gen={gen_w}x{gen_h}")
                if gen_w * gen_h < old_w * old_h:
                    raise ValueError(f"Resolution shrank: old={old_w}x{old_h}, gen={gen_w}x{gen_h}")

                # Encode to temp WebP preserving exact source aspect ratio & native upscaled pixels
                crop_expr = (
                    f"crop='trunc(min(iw,ih*{src_w}/{src_h})/2)*2'"
                    f":'trunc(min(ih,iw*{src_h}/{src_w})/2)*2'"
                )
                if tmp_webp.exists():
                    tmp_webp.unlink()
                enc = await arun_cmd([
                    FFMPEG_BIN, "-y", "-i", str(saved_path),
                    "-vf", crop_expr,
                    "-c:v", "libwebp", "-quality", "90", "-compression_level", "6",
                    str(tmp_webp)
                ])
                if enc.returncode != 0 or not tmp_webp.exists():
                    raise RuntimeError(f"WebP encode failed: {enc.stderr.strip()}")

                new_w, new_h = await probe_dims(tmp_webp)
                new_bytes = tmp_webp.stat().st_size
                if new_bytes < 4000:
                    raise ValueError(f"Encoded WebP too small ({new_bytes} bytes)")
                if new_w * new_h < old_w * old_h:
                    raise ValueError(f"Encoded WebP shrank: old={old_w}x{old_h}, new={new_w}x{new_h}")

                new_blur = await measure_blur(tmp_webp)
                ssim_vs_src = await compute_ssim_images(tmp_webp, src_png)
                if ssim_vs_src < 0.35:
                    raise ValueError(f"Severe composition drift: ssim_vs_src={ssim_vs_src:.3f} < 0.35")

                # Atomically replace media/<slug>.webp
                try:
                    os.replace(tmp_webp, media_webp)
                except OSError:
                    shutil.copy2(tmp_webp, media_webp)
                    tmp_webp.unlink(missing_ok=True)

                final_metrics = {
                    "slug": slug,
                    "name": name,
                    "status": "done",
                    "source": used_source,
                    "aspect_ratio": aspect_ratio,
                    "old_dims": f"{old_w}x{old_h}",
                    "new_dims": f"{new_w}x{new_h}",
                    "old_bytes": old_bytes,
                    "new_bytes": new_bytes,
                    "old_blur": old_blur,
                    "new_blur": new_blur,
                    "ssim_vs_src": round(ssim_vs_src, 4),
                    "attempts": attempt,
                    "error": None
                }
                log(
                    f"[OK] {slug}: {old_w}x{old_h} ({old_bytes}B, blur={old_blur}) -> "
                    f"{new_w}x{new_h} ({new_bytes}B, blur={new_blur}), ssim={ssim_vs_src:.3f}, src={used_source}"
                )
                return final_metrics
            except Exception as exc:
                last_err = str(exc)
                log(f"[WARN] {slug} attempt {attempt}/{max_retries} failed: {last_err}")

        raise RuntimeError(last_err or "All attempts failed")

    except Exception as exc:
        err_msg = str(exc)
        log(f"[FAIL] {slug}: {err_msg}")
        return {
            "slug": slug,
            "name": name,
            "status": "failed",
            "error": err_msg
        }


async def main() -> None:
    global FFMPEG_BIN, FFPROBE_BIN

    if not MODELS_JSON.exists():
        raise FileNotFoundError(f"models.json not found under {REPO_DIR}")

    wf_args = globals().get("args") or {}
    ffmpeg_dir = wf_args.get("ffmpeg_dir")
    resolved_ffmpeg = resolve_binary("ffmpeg", wf_args.get("ffmpeg_path"), ffmpeg_dir)
    resolved_ffprobe = resolve_binary("ffprobe", wf_args.get("ffprobe_path"), ffmpeg_dir)
    if not resolved_ffmpeg or not resolved_ffprobe:
        raise RuntimeError(
            f"Missing required binaries (ffmpeg={resolved_ffmpeg}, ffprobe={resolved_ffprobe}). "
            "Install FFmpeg and ensure both ffmpeg and ffprobe are on PATH, or pass "
            "`ffmpeg_dir` / `ffmpeg_path` / `ffprobe_path` via Args (or FFMPEG_BIN / FFPROBE_BIN env vars)."
        )
    FFMPEG_BIN = resolved_ffmpeg
    FFPROBE_BIN = resolved_ffprobe

    only = set(wf_args.get("only") or [])
    skip_slugs = set(wf_args.get("skip_slugs") or [])
    batch_size = int(wf_args.get("batch_size") or 4)
    max_retries = int(wf_args.get("max_retries") or 2)
    probe_first = bool(wf_args.get("probe_first", True))
    dry_run = bool(wf_args.get("dry_run", False))

    models = json.loads(MODELS_JSON.read_text(encoding="utf-8"))
    raw_state = load_state()
    state = {
        k: v for k, v in raw_state.items()
        if isinstance(v, dict) and v.get("status") != "quota_blocked"
    }

    todo = []
    skipped = []
    for m in models:
        slug = m["slug"]
        if only and slug not in only:
            continue
        if not only and slug in skip_slugs:
            skipped.append(slug)
            continue
        prev = state.get(slug)
        media_webp = MEDIA_DIR / f"{slug}.webp"
        if (
            not only
            and prev
            and prev.get("status") == "done"
            and media_webp.exists()
            and media_webp.stat().st_size == prev.get("new_bytes")
        ):
            skipped.append(slug)
            continue
        todo.append(m)

    log(
        f"REPO_DIR={REPO_DIR} | python={sys.version.split()[0]} | "
        f"ffmpeg={FFMPEG_BIN} | ffprobe={FFPROBE_BIN} | "
        f"Loaded {len(models)} models; todo={len(todo)}, skipped={len(skipped)}, "
        f"batch_size={batch_size}, probe_first={probe_first}, dry_run={dry_run}"
    )

    if dry_run:
        log(f"Dry run — first 5 queued slugs: {[m['slug'] for m in todo[:5]]}")
        return

    if not todo:
        log("Nothing to process.")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    SRC_PNG_DIR.mkdir(parents=True, exist_ok=True)
    TMP_WEBP_DIR.mkdir(parents=True, exist_ok=True)

    if probe_first and len(todo) > 1:
        chunks = [[todo[0]]] + [todo[i:i + batch_size] for i in range(1, len(todo), batch_size)]
    else:
        chunks = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    total_batches = len(chunks)
    newly_done = []
    quota_hits_this_run: List[dict] = []

    for idx, chunk in enumerate(chunks, start=1):
        label = "Probe 1" if (probe_first and len(todo) > 1 and idx == 1) else f"Batch {idx}/{total_batches}"
        phase(f"{label} ({', '.join(m['slug'] for m in chunk)})")
        results = await parallel(chunk, lambda m: process_one(m, max_retries))
        batch_quota_hits = []
        for res in results:
            if res.get("status") == "quota_blocked":
                batch_quota_hits.append(res)
                quota_hits_this_run.append(res)
            else:
                state[res["slug"]] = res
            if res.get("status") == "done":
                newly_done.append(res)
        save_state(state)

        if batch_quota_hits:
            for hit in batch_quota_hits:
                log(f"Stopping early due to quota exhaustion on '{hit['slug']}': {hit.get('error')}")
            break

        if idx < total_batches:
            await asyncio.sleep(1)

    phase("Summary")
    done_list = [v for v in state.values() if v.get("status") == "done"]
    fail_list = [v for v in state.values() if v.get("status") == "failed"]
    remaining = len(models) - len(done_list)
    log(
        f"Total in state: done={len(done_list)}, remaining={remaining}, "
        f"quota_blocked_this_run={len(quota_hits_this_run)}, failed={len(fail_list)}, "
        f"skipped_this_run={len(skipped)}, newly_done={len(newly_done)}"
    )

    if newly_done:
        log("Newly completed slugs this run:")
        for item in newly_done:
            log(f"  - {item['slug']}: {item['old_dims']} -> {item['new_dims']}, ssim={item['ssim_vs_src']}")

        with_ssim = [v for v in newly_done if isinstance(v.get("ssim_vs_src"), (int, float))]
        with_ssim.sort(key=lambda x: x["ssim_vs_src"])
        log("Lowest 5 SSIM among newly completed slugs:")
        for item in with_ssim[:5]:
            log(f"  - {item['slug']}: ssim={item['ssim_vs_src']}, {item['old_dims']}->{item['new_dims']}")

    if fail_list:
        log("Non-quota failed slugs:")
        for item in fail_list:
            log(f"  - {item['slug']}: {item.get('error')}")


await main()
