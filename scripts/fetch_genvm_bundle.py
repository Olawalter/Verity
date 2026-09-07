"""Put the GenVM runner bundle where the toolchain expects to find it.

Neither `genvm-lint` nor `gltest` direct mode can run without it, and on
a machine with a cold cache — a CI runner, a fresh clone — fetching it
does not currently work by itself:

  * `gltest` 0.29.2 asks GitHub for `<release>/genvm-universal.tar.xz`.
    The v0.3.0-rc line renamed that asset to `genvm-runners-all.tar.xz`,
    so the request 404s and every direct test errors out at import.
    `genvm-linter` 0.11.0 already tries both names; gltest has not caught
    up.
  * Both tools treat "the file exists" as "the file is good". A download
    interrupted at 90% leaves a truncated tarball in the cache, and every
    later run fails with `Compressed file ended before the end-of-stream
    marker` until someone deletes it by hand.

So this script downloads the asset that actually exists, verifies it
before anyone can see it, and only then moves it into place under the
name the tools look for. The move is atomic, so a cache entry is either
absent or complete — never half-written.

Both tools prefer a cached version over the newest release
(`list_cached_versions()` before `get_latest_version()`), which is what
makes seeding work at all: once the bundle is here, neither one goes to
the network, and an upstream retag cannot change what the tests run
against.

    python scripts/fetch_genvm_bundle.py
    GENVM_VERSION=v0.3.0-rc7 python scripts/fetch_genvm_bundle.py
"""
import os
import pathlib
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

# Pinned deliberately. The bundle has to contain the runner hash named in
# contracts/verity.py's `Depends` header; "whatever is latest" is not a
# promise that it does, and a test suite that silently changes runtime
# between runs is not a test suite.
DEFAULT_VERSION = "v0.3.0-rc7"

# Newest name first — the old one is kept so an older pin still resolves.
ASSETS = ("genvm-runners-all.tar.xz", "genvm-universal.tar.xz")

RELEASES = "https://github.com/genlayerlabs/genvm/releases"

# Both tools use the same filename in different directories.
CACHES = (
    pathlib.Path.home() / ".cache" / "genvm-linter",
    pathlib.Path.home() / ".cache" / "gltest-direct",
)

MIN_BYTES = 50 * 1024 * 1024      # the real bundle is ~128 MB


def targets(version: str):
    return [c / f"genvm-universal-{version}.tar.xz" for c in CACHES]


def usable(path: pathlib.Path) -> bool:
    """A cache entry counts only if it is complete.

    Checking the size is not enough: a truncated .tar.xz is exactly the
    failure this script exists to prevent, and it is only detectable by
    reading the stream to its end.
    """
    if not path.exists() or path.stat().st_size < MIN_BYTES:
        return False
    try:
        with tarfile.open(path, "r:xz") as tar:
            for _ in range(5):
                if tar.next() is None:
                    break
        return True
    except Exception:
        return False


def download(version: str, dest: pathlib.Path) -> None:
    last = None
    for asset in ASSETS:
        url = f"{RELEASES}/download/{version}/{asset}"
        print(f"fetching {url}")
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "verity-ci"})
            with urllib.request.urlopen(request, timeout=600) as response:
                total = int(response.headers.get("Content-Length") or 0)
                with open(dest, "wb") as handle:
                    copied = 0
                    step = 16 * 1024 * 1024
                    mark = step
                    while True:
                        chunk = response.read(1 << 20)
                        if not chunk:
                            break
                        handle.write(chunk)
                        copied += len(chunk)
                        if copied >= mark:
                            pct = f" ({copied * 100 // total}%)" if total else ""
                            print(f"  {copied // (1024 * 1024)} MB{pct}")
                            mark += step
            if total and dest.stat().st_size != total:
                raise IOError(
                    f"short read: {dest.stat().st_size} of {total} bytes")
            return
        except urllib.error.HTTPError as err:
            if err.code == 404:
                print(f"  not published under this release ({err.code})")
                last = err
                continue
            raise
    raise SystemExit(
        f"no runner bundle for {version}; tried {', '.join(ASSETS)}\n"
        f"last error: {last}")


def main() -> int:
    version = os.environ.get("GENVM_VERSION") or DEFAULT_VERSION
    wanted = targets(version)

    if all(usable(p) for p in wanted):
        print(f"genvm bundle {version} already cached and complete")
        return 0

    for path in wanted:
        if path.exists() and not usable(path):
            print(f"removing incomplete cache entry {path}")
            path.unlink()

    with tempfile.TemporaryDirectory() as tmp:
        staged = pathlib.Path(tmp) / "bundle.tar.xz"
        download(version, staged)

        if not usable(staged):
            raise SystemExit("downloaded bundle is not a readable .tar.xz")
        size = staged.stat().st_size
        print(f"verified {size} bytes")

        # Move into place only now, so no tool can ever observe a partial
        # file. The first target takes the download; the rest are copies.
        first = True
        for path in wanted:
            path.parent.mkdir(parents=True, exist_ok=True)
            if first:
                shutil.move(str(staged), str(path))
                first = False
            else:
                shutil.copy2(str(wanted[0]), str(path))
            print(f"installed {path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
